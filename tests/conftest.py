from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from limits.storage import storage_from_string
from limits.strategies import STRATEGIES as LIMIT_STRATEGIES
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

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
    engine = create_async_engine(settings.database_url, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
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
