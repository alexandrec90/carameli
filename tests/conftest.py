from __future__ import annotations

import hashlib
import json
import os
from collections.abc import AsyncGenerator, Mapping
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from limits.storage import storage_from_string
from limits.strategies import STRATEGIES as LIMIT_STRATEGIES
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models
from alembic import command
from app.core.config import settings
from app.core.database import Base, get_session
from app.core.limiter import limiter as rate_limiter
from app.main import app
from app.services.providers.base import ProvisionedSipClient

# Alembic project layout, resolved relative to the repo root (tests/../alembic)
# so the schema build works regardless of the pytest invocation directory.
_ALEMBIC_DIR = Path(__file__).resolve().parent.parent / "alembic"
_VERSIONS_DIR = _ALEMBIC_DIR / "versions"


def _upgrade_to_head(sync_connection: Connection) -> None:
    """Build the schema by running Alembic migrations on an existing connection.

    Injecting the connection via ``cfg.attributes["connection"]`` makes the
    migrations run inside the caller's transaction (see
    ``alembic/env.py::run_migrations_online``), so the schema build stays part
    of the fixture's session-setup transaction and advisory lock -- no second
    connection, no early commit.

    A bare ``Config()`` (no .ini file) is deliberate: it leaves
    ``config_file_name`` unset so ``env.py`` skips ``fileConfig``, which would
    otherwise re-run logging config with ``disable_existing_loggers`` and
    silence the app loggers mid-test-session.
    """
    cfg = Config()
    cfg.set_main_option("script_location", str(_ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    cfg.attributes["connection"] = sync_connection
    command.upgrade(cfg, "head")


# All async tests run on a single session-scoped event loop so that
# the session-scoped engine/connection pool stays valid across tests.
pytestmark = pytest.mark.asyncio(loop_scope="session")

# Tests run against the real PostgreSQL DB (requires Docker running).
# Run: docker compose exec app pytest


def _schema_fingerprint() -> str:
    """SHA256 prefix of a stable representation of the schema's sources.

    Combines Base.metadata (table/column names + types) with the contents of
    every Alembic migration file. Changes whenever a model changes *or* a
    migration is added or edited. Used to decide whether the test DB schema is
    still current so we can skip the expensive DROP/CREATE/migrate rebuild.

    Migrations must feed the fingerprint because the schema is now built by
    running them (not create_all): a migration that adds a migration-only
    object (an extension, raw-SQL DDL, a CHECK constraint) leaves Base.metadata
    unchanged, so without hashing the migrations a warm DB would keep taking
    the TRUNCATE fast path and never pick the new object up.
    """
    parts = [
        (
            table.name,
            sorted((c.name, str(c.type)) for c in table.columns),
        )
        for table in sorted(Base.metadata.tables.values(), key=lambda t: t.name)
    ]
    migrations = [
        (path.name, hashlib.sha256(path.read_bytes()).hexdigest())
        for path in sorted(_VERSIONS_DIR.glob("*.py"))
    ]
    return hashlib.sha256(repr((parts, migrations)).encode()).hexdigest()[:16]


def _mock_call_engine() -> MagicMock:
    engine = MagicMock()
    engine.provision_sip_client = AsyncMock(
        side_effect=lambda username, _password: ProvisionedSipClient(
            client_sid=f"client-{username}", sip_realm="sip.test"
        )
    )
    engine.update_sip_client_password = AsyncMock()
    engine.deprovision_sip_client = AsyncMock()
    engine.play_audio_to_call = AsyncMock(return_value={"status": "playing"})
    engine.get_active_calls = AsyncMock(return_value=[])
    return engine


def assert_disposable_database(url: str, env: Mapping[str, str]) -> None:
    """Refuse to run when `url` names a database nobody marked as disposable.

    `test_engine` empties every table before the first test. That is correct against
    a scratch database and catastrophic against any other, and nothing in the run
    distinguishes them: the truncation is silent, instant, and the suite passes
    either way, so the loss surfaces days later as calls that stop routing.

    It has already happened once. On 2026-08-20 a bare `pytest` inside an ephemeral
    worktree emptied the primary stack's `carameli` database -- the box had seeded
    its `.env` from the source checkout, so DATABASE_URL named localhost:5432 while
    the box's own Postgres sat unused on its leased port. No backup existed.

    Three things count as consent, and a name is not one of them on its own:

    - `CI` is set. A runner's Postgres is created per job and dies with it.
    - the database name ends in `_test`, which is a name chosen for this.
    - `CARAMELI_ALLOW_DB_TRUNCATE=1`, for a scratch database called something else.

    Everything else raises here rather than at the first missing row.
    """
    name = urlsplit(url).path.lstrip("/") or "(unnamed)"
    if env.get("CI"):
        return
    if name.endswith("_test") or name == "test":
        return
    if env.get("CARAMELI_ALLOW_DB_TRUNCATE") == "1":
        return

    target = urlsplit(url).netloc.rsplit("@", 1)[-1]
    raise RuntimeError(
        f"refusing to empty the database {name!r} on {target}: the test session "
        f"TRUNCATEs every table before it starts, and nothing marks this one as "
        f"disposable.\n"
        f"  - point DATABASE_URL at a scratch database whose name ends in '_test' "
        f"(carameli_test exists for this), or\n"
        f"  - export CARAMELI_ALLOW_DB_TRUNCATE=1 if you meant this one.\n"
        f"Inside a worktree box, DATABASE_URL is seeded from the source checkout and "
        f"names the PRIMARY stack's database, not the box's own."
    )


@pytest_asyncio.fixture(scope="session")
async def test_engine() -> AsyncGenerator[AsyncEngine, None]:
    assert_disposable_database(settings.database_url, os.environ)
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        connect_args={"prepared_statement_cache_size": 0},
    )
    # pytest-xdist spins up one worker per CPU, all sharing the same
    # PostgreSQL database.  Two races must be prevented:
    #
    # 1. Concurrent create_all: SQLAlchemy's check-first is not atomic;
    #    two workers can both pass the "table doesn't exist" check and then
    #    both attempt CREATE TABLE, causing a pg_type_typname_nsp_index
    #    UniqueViolationError.  Solved by a transaction-level advisory lock
    #    (released on commit) that serialises all setup.
    #
    # 2. Teardown race: if we drop tables at the end of each worker's
    #    session, a fast worker (gw0) finishing unit tests can drop the
    #    schema while a slow worker (gw1) is still running contract tests.
    #    Solved by doing ALL cleanup at the START of the next run instead
    #    of at the end — only the primary worker resets state in the setup
    #    phase, ensuring a clean state at run start without touching
    #    anything during teardown.
    #
    # Session reset strategy: the primary worker fingerprints the schema
    # sources (Base.metadata + every migration file) and compares it to a
    # comment stored on the public schema by a previous run.  If they match, it
    # TRUNCATEs all tables with RESTART IDENTITY CASCADE (~100ms, atomic, resets
    # sequences).  If they differ (first run, or models/migrations changed), it
    # falls back to DROP SCHEMA + CREATE SCHEMA + `alembic upgrade head` (~1-3s)
    # and stamps the new fingerprint.  Building the slow path from migrations
    # (not create_all) keeps the test DB faithful to production, including
    # migration-only objects.  Both paths guarantee every table is empty at
    # session start — the defence against data leaking from a crashed run.
    #
    # Advisory lock key 7654321987 is also acquired by _contract_env so
    # that schemathesis tests serialise with this setup.
    worker_id = os.environ.get("PYTEST_XDIST_WORKER", "master")
    is_primary = worker_id in ("master", "gw0")
    fingerprint = _schema_fingerprint()
    expected_comment = f"fingerprint={fingerprint}"

    async with engine.begin() as conn:
        # Acquire lock first so non-primary workers block until the
        # primary has finished resetting state.
        await conn.execute(text("SELECT pg_advisory_xact_lock(7654321987)"))
        if is_primary:
            existing_comment = (
                await conn.execute(
                    text("SELECT obj_description('public'::regnamespace, 'pg_namespace')")
                )
            ).scalar()

            if existing_comment == expected_comment:
                # Fast path: schema matches, just empty every table.
                table_list = ", ".join(
                    f'"{t.name}"'
                    for t in sorted(Base.metadata.tables.values(), key=lambda t: t.name)
                )
                if table_list:
                    await conn.execute(
                        text(f"TRUNCATE TABLE {table_list} RESTART IDENTITY CASCADE")
                    )
            else:
                # Slow path: first run, or schema drift -- full rebuild by
                # running the Alembic migrations, NOT Base.metadata.create_all.
                # create_all only builds model-defined tables, so any
                # migration-only object (extensions like pg_stat_statements,
                # raw-SQL DDL, CHECK constraints, functions) would silently be
                # absent and the test DB would diverge from a migrated prod DB.
                # Building from migrations keeps the two faithful.
                await conn.execute(text("DROP SCHEMA public CASCADE"))
                await conn.execute(text("CREATE SCHEMA public"))
                await conn.run_sync(_upgrade_to_head)
                # fingerprint is sha256 hex (16 chars, [0-9a-f]) -- safe to
                # interpolate; COMMENT ON does not accept bind parameters.
                await conn.execute(text(f"COMMENT ON SCHEMA public IS 'fingerprint={fingerprint}'"))
        else:
            # Non-primary workers: ensure tables exist. No-op after the primary
            # committed the migration-built schema above (create_all checks
            # first); it never runs migrations, so it cannot double-stamp
            # alembic_version. Lock released when this transaction commits.
            await conn.run_sync(Base.metadata.create_all)

    try:
        yield engine
    finally:
        # No schema teardown here — the next run's primary worker will
        # reset state at startup (see above).  Touching state here would
        # race with other workers that may still be executing tests.
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    async with test_engine.connect() as conn:
        await conn.begin()
        session_factory = async_sessionmaker(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        async with session_factory() as session:
            yield session
        await conn.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    async def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    # Pre-populate state so the lifespan override lands on top; individual tests
    # replace specific methods with AsyncMock as needed.
    app.state.carrier = MagicMock()
    app.state.engine = _mock_call_engine()

    # Swap rate-limiter storage to in-memory so unit tests don't need Redis.
    _real_storage = rate_limiter._storage
    _real_rl = rate_limiter._limiter
    _mem_storage = storage_from_string("memory://")
    rate_limiter._storage = _mem_storage
    rate_limiter._limiter = LIMIT_STRATEGIES["fixed-window"](_mem_storage)

    # Remove SlowAPIMiddleware during tests: it inherits BaseHTTPMiddleware
    # which runs the route handler in a child task, breaking the shared
    # asyncpg connection used by db_session.
    original_middleware = list(app.user_middleware)
    app.user_middleware = [m for m in app.user_middleware if m.cls is not SlowAPIMiddleware]
    app.middleware_stack = app.build_middleware_stack()

    # raise_app_exceptions=False: Starlette's ServerErrorMiddleware re-raises an
    # unhandled exception after the `Exception` handler returns its 500 response,
    # so without this the transport would propagate it instead of yielding the 500.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Restore original middleware and rate-limiter storage.
    app.user_middleware = original_middleware
    app.middleware_stack = app.build_middleware_stack()
    rate_limiter._storage = _real_storage
    rate_limiter._limiter = _real_rl
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def concurrent_client(test_engine):
    """HTTP client for concurrency tests; does NOT override get_session.

    Each request creates its own real DB connection so asyncio.gather does not
    contend on a single asyncpg connection.  Data written here persists until
    the next run's TRUNCATE — tests using this fixture must use unique
    vs_customer_ids (8000-range) to avoid collisions with other tests.
    """
    app.state.carrier = MagicMock()
    app.state.engine = _mock_call_engine()

    _real_storage = rate_limiter._storage
    _real_rl = rate_limiter._limiter
    _mem_storage = storage_from_string("memory://")
    rate_limiter._storage = _mem_storage
    rate_limiter._limiter = LIMIT_STRATEGIES["fixed-window"](_mem_storage)

    original_middleware = list(app.user_middleware)
    app.user_middleware = [m for m in app.user_middleware if m.cls is not SlowAPIMiddleware]
    app.middleware_stack = app.build_middleware_stack()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.user_middleware = original_middleware
    app.middleware_stack = app.build_middleware_stack()
    rate_limiter._storage = _real_storage
    rate_limiter._limiter = _real_rl
    app.dependency_overrides.clear()


API_KEY = settings.api_key_secret
AUTH_HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def notify_payload(call) -> dict:
    """Decode the JSON body of a mocked VanillaSoft notify POST.

    `vanillasoft_notify` pre-serializes the payload and posts `content=` so the
    `X-Carameli-Signature` HMAC covers the exact bytes on the wire — there is no
    `json=` kwarg to read.
    """
    return json.loads(call.kwargs["content"])
