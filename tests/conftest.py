from __future__ import annotations

import hashlib
import os
from collections.abc import AsyncGenerator
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from limits.storage import storage_from_string
from limits.strategies import STRATEGIES as LIMIT_STRATEGIES
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models
from app.core.config import settings
from app.core.database import Base, get_session
from app.core.limiter import limiter as rate_limiter
from app.main import app

# All async tests run on a single session-scoped event loop so that
# the session-scoped engine/connection pool stays valid across tests.
pytestmark = pytest.mark.asyncio(loop_scope="session")

# Tests run against the real PostgreSQL DB (requires Docker running).
# Run: docker compose exec app pytest


def _schema_fingerprint() -> str:
    """SHA256 prefix of a stable representation of Base.metadata.

    Changes whenever any table name, column name, or column type changes.
    Used to decide whether the test DB schema still matches the current
    models so we can skip the expensive DROP/CREATE/create_all path.
    """
    parts = [
        (
            table.name,
            sorted((c.name, str(c.type)) for c in table.columns),
        )
        for table in sorted(Base.metadata.tables.values(), key=lambda t: t.name)
    ]
    return hashlib.sha256(repr(parts).encode()).hexdigest()[:16]


@pytest_asyncio.fixture(scope="session")
async def test_engine() -> AsyncGenerator[AsyncEngine, None]:
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
    # Session reset strategy: the primary worker fingerprints Base.metadata
    # and compares it to a comment stored on the public schema by a previous
    # run.  If they match, it TRUNCATEs all tables with RESTART IDENTITY
    # CASCADE (~100ms, atomic, resets sequences).  If they differ (first
    # run, or models changed), it falls back to DROP SCHEMA + CREATE SCHEMA
    # + create_all (~1-3s) and stamps the new fingerprint.  Both paths
    # guarantee every table is empty at session start — the defence against
    # data leaking from a crashed previous run.
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
                # Slow path: first run, or schema drift -- full rebuild.
                await conn.execute(text("DROP SCHEMA public CASCADE"))
                await conn.execute(text("CREATE SCHEMA public"))
                await conn.run_sync(Base.metadata.create_all)
                # fingerprint is sha256 hex (16 chars, [0-9a-f]) -- safe to
                # interpolate; COMMENT ON does not accept bind parameters.
                await conn.execute(text(f"COMMENT ON SCHEMA public IS 'fingerprint={fingerprint}'"))
            # Migration 013 enables pg_stat_statements, but the test DB is built
            # from Base.metadata (create_all), which never builds migration-only
            # objects like extensions -- and the slow-path DROP SCHEMA above
            # drops the extension the CI `alembic upgrade head` step created.
            # Recreate it on every primary setup (both paths) so a from-models
            # test DB matches a migration-built one, keeping
            # test_schema_indexes.py::test_pg_stat_statements_extension_exists
            # green on a cold CI database. CREATE EXTENSION succeeds without
            # shared_preload_libraries (the catalog row is what the test checks).
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_stat_statements"))
        else:
            # Non-primary workers: ensure tables exist (no-op after primary's
            # fast path, and also after primary's slow path via create_all).
            # Lock released when this transaction commits.
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
    app.state.engine = MagicMock()

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
    app.state.engine = MagicMock()

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
