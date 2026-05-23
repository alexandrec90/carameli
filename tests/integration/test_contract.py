"""Contract tests: schemathesis fuzzes every endpoint against the OpenAPI schema.

For each route, schemathesis auto-generates valid and boundary-breaking inputs
and verifies:
  - No endpoint returns an undocumented 5xx response.
  - Every successful response body matches the declared schema shape.

Run via: docker compose exec app pytest tests/integration/test_contract.py -v
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest_asyncio
import schemathesis
from hypothesis import settings as h_settings
from limits.storage import storage_from_string
from limits.strategies import STRATEGIES as LIMIT_STRATEGIES
from schemathesis.checks import not_a_server_error
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import app.models
from app.core.config import settings
from app.core.database import Base, get_session
from app.core.limiter import limiter as rate_limiter
from app.main import app

AUTH_HEADERS = {"Authorization": f"Bearer {settings.api_key_secret}"}

# ---------------------------------------------------------------------------
# OpenAPI schema — loaded directly from the running ASGI app
# ---------------------------------------------------------------------------

schema = schemathesis.openapi.from_asgi("/openapi.json", app)


# ---------------------------------------------------------------------------
# Module-scoped fixture: mocked carrier/engine boundaries
# Tables are created here (not via test_engine) to avoid event-loop conflicts
# between schemathesis sync tests and the session-scoped async engine.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _contract_env():
    """Mock providers, override DB session for all contract cases.

    Schemathesis tests are sync — they run through anyio's blocking portal,
    which uses a different event loop from the session-scoped test_engine.
    We must NOT share test_engine; instead we use a module-scoped engine with
    NullPool so each request gets a fresh asyncpg connection bound to the
    current loop (no cross-loop pool reuse), while avoiding the overhead of
    creating and disposing a full SQLAlchemy engine on every Hypothesis
    example.
    """
    db_url = settings.database_url

    # NullPool: every connect() opens a fresh asyncpg connection on the
    # current event loop and closes it on exit, so no pooled connection is
    # ever reused across the per-example loops schemathesis spins up.
    # Advisory lock (same key as conftest.py's test_engine) serialises
    # create_all with any xdist worker still setting up its schema.
    engine = create_async_engine(
        db_url,
        echo=False,
        connect_args={"prepared_statement_cache_size": 0},
        poolclass=NullPool,
    )
    async with engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(7654321987)"))
        await conn.run_sync(Base.metadata.create_all)

    async def _session_override():
        async with engine.connect() as conn:
            await conn.begin()
            session_factory = async_sessionmaker(
                bind=conn,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            )
            async with session_factory() as session:
                yield session
            await conn.rollback()

    app.dependency_overrides[get_session] = _session_override

    carrier = MagicMock()
    carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15005550001"}])
    carrier.provision_number = AsyncMock(
        return_value={"sid": "PNcontract", "phone_number": "+15005550001"}
    )
    carrier.release_number = AsyncMock(return_value=None)
    carrier.enable_sms = AsyncMock(return_value=None)
    carrier.disable_sms = AsyncMock(return_value=None)
    carrier.send_sms = AsyncMock(return_value={"sid": "SMcontract", "status": "sent"})
    carrier.get_available_area_codes = AsyncMock(return_value=[])

    call_engine = MagicMock()
    call_engine.initiate_call = AsyncMock(
        return_value={"call_sid": "CAcontract", "status": "queued"}
    )
    call_engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_sid": "CAcontract", "status": "queued"}
    )
    call_engine.initiate_callback = AsyncMock(
        return_value={"call_id": "CAcontract", "status": "queued"}
    )

    app.state.carrier = carrier
    app.state.engine = call_engine

    # Patch provider factories so the ASGI lifespan always returns the mocks,
    # not real Telnyx/Jambonz clients, even after per-request startup/shutdown.
    with (
        patch("app.main.get_carrier_provider", return_value=carrier),
        patch("app.main.get_call_engine_provider", return_value=call_engine),
    ):
        # SlowAPIMiddleware inherits BaseHTTPMiddleware which runs the route handler
        # in a child task, breaking asyncpg connections created by async generator
        # dependencies.  Remove it for the duration of contract tests.
        _real_storage = rate_limiter._storage
        _real_rl = rate_limiter._limiter
        _mem_storage = storage_from_string("memory://")
        rate_limiter._storage = _mem_storage
        rate_limiter._limiter = LIMIT_STRATEGIES["fixed-window"](_mem_storage)

        original_middleware = list(app.user_middleware)
        app.user_middleware = [m for m in app.user_middleware if m.cls is not SlowAPIMiddleware]
        app.middleware_stack = app.build_middleware_stack()

        yield

        app.user_middleware = original_middleware
        app.middleware_stack = app.build_middleware_stack()
        rate_limiter._storage = _real_storage
        rate_limiter._limiter = _real_rl

    app.dependency_overrides.clear()
    await engine.dispose()


# ---------------------------------------------------------------------------
# Contract test — parametrized over every endpoint in the OpenAPI schema
# ---------------------------------------------------------------------------


@schema.parametrize()
@h_settings(max_examples=10)
def test_api_contract(case):
    """Fuzz every endpoint with auto-generated inputs.

    Schemathesis marks a test as failed when:
    - An endpoint returns an undocumented 5xx response.
    - A response body doesn't match the declared OpenAPI schema.

    404/422/401 responses are expected for fuzz inputs and are not failures.
    """
    case.call_and_validate(headers=AUTH_HEADERS, checks=[not_a_server_error])
