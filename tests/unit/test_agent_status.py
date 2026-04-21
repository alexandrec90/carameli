"""Tests for agent-status polling cron and read endpoint.

Mocking strategy
----------------
- Jambonz provider methods (get_active_calls, get_registrations) are mocked at
  the Protocol boundary via AsyncMock on a plain MagicMock object — never on
  the concrete JambonzEngine class.
- The DB is the real rollback-wrapped PostgreSQL test instance (per conftest).
- No imports of jambonz.py — mocks live entirely behind the Protocol surface.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_AGENT_BASE = "/vsapi/1.0.0/AgentStatus"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _create_customer(client, vs_id: int) -> dict:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


async def _create_extension(client, vs_id: int, ext_num: str, sip_user: str) -> dict:
    resp = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={"vs_customer_id": vs_id, "extension_number": ext_num, "password": "pw"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


# ─────────────────────────────────────────────────────────────────────────────
# Unit: poll_agent_status merge logic
# ─────────────────────────────────────────────────────────────────────────────


async def test_poll_merges_call_state_and_registration(db_session) -> None:
    """Cron upserts correct call_state and sip_registered derived from Jambonz data."""
    from app.models.customer import Customer
    from app.models.extension import Extension
    from app.repositories.agent_status_repo import AgentStatusRepo
    from app.services.agent_status_sync import poll_agent_status

    # Insert a customer + extension directly via ORM (no HTTP round-trip needed).
    customer = Customer(vs_customer_id=9801, api_key="key-9801")
    db_session.add(customer)
    await db_session.commit()
    await db_session.refresh(customer)

    ext = Extension(
        customer_id=customer.id,
        extension_number="101",
        sip_username="ext101_test9801",
    )
    db_session.add(ext)
    await db_session.commit()
    await db_session.refresh(ext)

    # Mock the engine at the Protocol boundary.
    mock_engine = MagicMock()
    mock_engine.get_active_calls = AsyncMock(
        return_value=[
            {
                "sip_user": "ext101_test9801",
                "call_status": "in-progress",
                "call_sid": "CS-abc123",
            }
        ]
    )
    mock_engine.get_registrations = AsyncMock(return_value=[{"sipUser": "ext101_test9801"}])

    ctx: dict = {"engine": mock_engine}

    # Patch async_session_factory so the cron uses our rollback-wrapped session.
    import app.services.agent_status_sync as sync_module

    def _fake_session_factory():
        class _FakeCM:
            async def __aenter__(self):
                return db_session

            async def __aexit__(self, *args):
                pass

        return _FakeCM()

    with patch.object(sync_module, "async_session_factory", _fake_session_factory):
        await poll_agent_status(ctx)

    repo = AgentStatusRepo(db_session)
    rows = await repo.get_for_customer(customer.id)

    assert len(rows) == 1
    row = rows[0]
    assert row.sip_username == "ext101_test9801"
    assert row.call_state == "on-call"
    assert row.call_sid == "CS-abc123"
    assert row.sip_registered is True


async def test_poll_idle_when_no_active_call(db_session) -> None:
    """Agent with no active call gets call_state='idle'."""
    from app.models.customer import Customer
    from app.models.extension import Extension
    from app.repositories.agent_status_repo import AgentStatusRepo
    from app.services.agent_status_sync import poll_agent_status

    customer = Customer(vs_customer_id=9802, api_key="key-9802")
    db_session.add(customer)
    await db_session.commit()
    await db_session.refresh(customer)

    ext = Extension(
        customer_id=customer.id,
        extension_number="201",
        sip_username="ext201_test9802",
    )
    db_session.add(ext)
    await db_session.commit()
    await db_session.refresh(ext)

    mock_engine = MagicMock()
    mock_engine.get_active_calls = AsyncMock(return_value=[])
    mock_engine.get_registrations = AsyncMock(return_value=[{"sipUser": "ext201_test9802"}])

    ctx: dict = {"engine": mock_engine}

    import app.services.agent_status_sync as sync_module

    def _fake_session_factory():
        class _FakeCM:
            async def __aenter__(self):
                return db_session

            async def __aexit__(self, *args):
                pass

        return _FakeCM()

    with patch.object(sync_module, "async_session_factory", _fake_session_factory):
        await poll_agent_status(ctx)

    rows = await AgentStatusRepo(db_session).get_for_customer(customer.id)
    assert len(rows) == 1
    assert rows[0].call_state == "idle"
    assert rows[0].call_sid is None
    assert rows[0].sip_registered is True


async def test_poll_not_registered(db_session) -> None:
    """Agent with no SIP registration gets sip_registered=False."""
    from app.models.customer import Customer
    from app.models.extension import Extension
    from app.repositories.agent_status_repo import AgentStatusRepo
    from app.services.agent_status_sync import poll_agent_status

    customer = Customer(vs_customer_id=9803, api_key="key-9803")
    db_session.add(customer)
    await db_session.commit()
    await db_session.refresh(customer)

    ext = Extension(
        customer_id=customer.id,
        extension_number="301",
        sip_username="ext301_test9803",
    )
    db_session.add(ext)
    await db_session.commit()
    await db_session.refresh(ext)

    mock_engine = MagicMock()
    mock_engine.get_active_calls = AsyncMock(return_value=[])
    mock_engine.get_registrations = AsyncMock(return_value=[])  # nobody registered

    ctx: dict = {"engine": mock_engine}

    import app.services.agent_status_sync as sync_module

    def _fake_session_factory():
        class _FakeCM:
            async def __aenter__(self):
                return db_session

            async def __aexit__(self, *args):
                pass

        return _FakeCM()

    with patch.object(sync_module, "async_session_factory", _fake_session_factory):
        await poll_agent_status(ctx)

    rows = await AgentStatusRepo(db_session).get_for_customer(customer.id)
    assert len(rows) == 1
    assert rows[0].sip_registered is False


async def test_poll_survives_jambonz_api_error(db_session) -> None:
    """A failed Jambonz API call must not raise — the worker must survive."""
    from app.services.agent_status_sync import poll_agent_status

    mock_engine = MagicMock()
    mock_engine.get_active_calls = AsyncMock(side_effect=Exception("Jambonz down"))
    mock_engine.get_registrations = AsyncMock(return_value=[])

    ctx: dict = {"engine": mock_engine}
    # Must not raise.
    await poll_agent_status(ctx)


async def test_poll_no_engine_in_ctx(db_session) -> None:
    """Missing ctx['engine'] must not crash the worker."""
    from app.services.agent_status_sync import poll_agent_status

    await poll_agent_status({})  # must not raise


async def test_poll_upserts_on_second_call(db_session) -> None:
    """Second poll overwrites the existing row (upsert, not insert)."""
    from app.models.customer import Customer
    from app.models.extension import Extension
    from app.repositories.agent_status_repo import AgentStatusRepo
    from app.services.agent_status_sync import poll_agent_status

    customer = Customer(vs_customer_id=9804, api_key="key-9804")
    db_session.add(customer)
    await db_session.commit()
    await db_session.refresh(customer)

    ext = Extension(
        customer_id=customer.id,
        extension_number="401",
        sip_username="ext401_test9804",
    )
    db_session.add(ext)
    await db_session.commit()
    await db_session.refresh(ext)

    import app.services.agent_status_sync as sync_module

    def _fake_session_factory():
        class _FakeCM:
            async def __aenter__(self):
                return db_session

            async def __aexit__(self, *args):
                pass

        return _FakeCM()

    mock_engine = MagicMock()
    mock_engine.get_active_calls = AsyncMock(
        return_value=[
            {"sip_user": "ext401_test9804", "call_status": "in-progress", "call_sid": "CS-first"}
        ]
    )
    mock_engine.get_registrations = AsyncMock(return_value=[{"sipUser": "ext401_test9804"}])

    ctx: dict = {"engine": mock_engine}
    with patch.object(sync_module, "async_session_factory", _fake_session_factory):
        await poll_agent_status(ctx)

    # Second poll: agent now idle.
    mock_engine.get_active_calls = AsyncMock(return_value=[])
    with patch.object(sync_module, "async_session_factory", _fake_session_factory):
        await poll_agent_status(ctx)

    rows = await AgentStatusRepo(db_session).get_for_customer(customer.id)
    assert len(rows) == 1  # still only one row
    assert rows[0].call_state == "idle"
    assert rows[0].call_sid is None


# ─────────────────────────────────────────────────────────────────────────────
# Integration: GET /AgentStatus/{customerId}
# ─────────────────────────────────────────────────────────────────────────────


async def test_get_agent_status_returns_rows(client, db_session) -> None:
    """Endpoint returns agent statuses scoped to the requested customer."""
    from app.models.agent_status import AgentStatus
    from app.models.customer import Customer
    from app.models.extension import Extension

    # Create customer + extension via HTTP (exercises auth/scope path).
    await _create_customer(client, 9810)

    # We need the internal UUID — look it up directly.
    from sqlalchemy import select

    result = await db_session.execute(select(Customer).where(Customer.vs_customer_id == 9810))
    customer = result.scalar_one()

    ext = Extension(
        customer_id=customer.id,
        extension_number="501",
        sip_username="ext501_test9810",
    )
    db_session.add(ext)
    await db_session.commit()
    await db_session.refresh(ext)

    # Insert a pre-existing agent_status row directly (simulates a previous poll).
    row = AgentStatus(
        customer_id=customer.id,
        extension_id=ext.id,
        sip_username="ext501_test9810",
        call_state="idle",
        call_sid=None,
        sip_registered=True,
    )
    db_session.add(row)
    await db_session.commit()

    resp = await client.get(f"{_AGENT_BASE}/9810", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["sip_username"] == "ext501_test9810"
    assert data[0]["sip_registered"] is True
    assert data[0]["call_state"] == "idle"
    assert "polled_at" in data[0]


async def test_get_agent_status_empty_when_no_rows(client) -> None:
    """Returns empty list when no polls have run yet for this customer."""
    await _create_customer(client, 9811)
    resp = await client.get(f"{_AGENT_BASE}/9811", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_agent_status_404_unknown_customer(client) -> None:
    """Returns 404 for a vs_customer_id that does not exist."""
    resp = await client.get(f"{_AGENT_BASE}/99999", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_get_agent_status_scoped_to_customer(client, db_session) -> None:
    """Rows from a different customer are not returned."""
    from app.models.agent_status import AgentStatus
    from app.models.customer import Customer

    await _create_customer(client, 9812)
    await _create_customer(client, 9813)

    from sqlalchemy import select

    result_a = await db_session.execute(select(Customer).where(Customer.vs_customer_id == 9812))
    result_a.scalar_one()

    result_b = await db_session.execute(select(Customer).where(Customer.vs_customer_id == 9813))
    customer_b = result_b.scalar_one()

    # Only insert a row for customer_b.
    row = AgentStatus(
        customer_id=customer_b.id,
        sip_username="ext_other_customer",
        call_state="on-call",
        sip_registered=True,
    )
    db_session.add(row)
    await db_session.commit()

    # customer_a should see nothing.
    resp = await client.get(f"{_AGENT_BASE}/9812", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_agent_status_requires_auth(client) -> None:
    """Unauthenticated request must be rejected."""
    resp = await client.get(f"{_AGENT_BASE}/9810")
    assert resp.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# _map_call_status
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("trying", "ringing"),
        ("ringing", "ringing"),
        ("early", "ringing"),
        ("in-progress", "on-call"),
        ("completed", "idle"),
        ("failed", "idle"),
        ("TRYING", "ringing"),  # case-insensitive
        ("unknown-state", "unknown-state"),  # passthrough
    ],
)
def test_map_call_status(raw: str, expected: str) -> None:
    from app.services.agent_status_sync import _map_call_status

    assert _map_call_status(raw) == expected


# ─────────────────────────────────────────────────────────────────────────────
# startup / shutdown
# ─────────────────────────────────────────────────────────────────────────────


async def test_startup_stores_engine_on_ctx() -> None:
    from app.services.agent_status_sync import startup

    ctx: dict = {}
    await startup(ctx)
    assert "engine" in ctx


async def test_shutdown_calls_aclose() -> None:
    from app.services.agent_status_sync import shutdown

    mock_engine = MagicMock()
    mock_engine.aclose = AsyncMock()
    await shutdown({"engine": mock_engine})
    mock_engine.aclose.assert_awaited_once()


async def test_shutdown_no_engine_does_not_raise() -> None:
    from app.services.agent_status_sync import shutdown

    await shutdown({})  # must not raise
