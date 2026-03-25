from __future__ import annotations

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
    #    (released on commit) that serialises all create_all calls.
    #
    # 2. Teardown race: if we drop tables at the end of each worker's
    #    session, a fast worker (gw0) finishing unit tests can drop the
    #    schema while a slow worker (gw1) is still running contract tests.
    #    Solved by doing ALL cleanup at the START of the next run instead
    #    of at the end — only the primary worker drops + recreates the
    #    schema in the setup phase, ensuring a fresh state at run start
    #    without touching anything during teardown.
    #
    # Advisory lock key 7654321987 is also acquired by _contract_env so
    # that schemathesis tests serialise with this setup.
    worker_id = os.environ.get("PYTEST_XDIST_WORKER", "master")
    is_primary = worker_id in ("master", "gw0")

    async with engine.begin() as conn:
        # Acquire lock first so non-primary workers block until the
        # primary has finished dropping + creating.
        await conn.execute(text("SELECT pg_advisory_xact_lock(7654321987)"))
        if is_primary:
            # Fresh schema at the beginning of each run so leftover data
            # from a previous (possibly crashed) run cannot affect tests.
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        # create_all is a no-op for tables that already exist (primary
        # created them above); for non-primary workers this is always a
        # no-op.  Lock released when this transaction commits.
        await conn.run_sync(Base.metadata.create_all)

    try:
        yield engine
    finally:
        # No schema teardown here — the next run's primary worker will
        # drop + recreate at startup (see above).  Dropping here would
        # race with other workers that may still be executing tests.
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    async with test_engine.connect() as conn:
        txn = await conn.begin()
        session_factory = async_sessionmaker(bind=conn, expire_on_commit=False)
        async with session_factory() as session:
            yield session
        await txn.rollback()


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

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Restore original middleware and rate-limiter storage.
    app.user_middleware = original_middleware
    app.middleware_stack = app.build_middleware_stack()
    rate_limiter._storage = _real_storage
    rate_limiter._limiter = _real_rl
    app.dependency_overrides.clear()


API_KEY = settings.api_key_secret
AUTH_HEADERS = {"Authorization": f"Bearer {API_KEY}"}
