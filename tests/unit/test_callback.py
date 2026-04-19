from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.services.callback_state import pending_callbacks, pending_callbacks_lock
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_EXT_BASE = "/vsapi/1.0.0/VsExtension"
_CB_BASE = "/vsapi/1.0.0/Callback"
_CB_ANSWERED = "/webhooks/jambonz/callback-answered"


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_extension(client, vs_id: int, ext_number: str) -> dict:
    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": f"PNtest{vs_id}", "phone_number": f"+1{vs_id}0000"}
    )
    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": vs_id, "extension_number": ext_number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    return resp.json()


# ---------------------------------------------------------------------------
# POST /Callback/ByExtension — happy path
# ---------------------------------------------------------------------------


async def test_callback_by_extension_success(client) -> None:
    """Valid request initiates the callback and returns call_sid + status."""
    from app.main import app

    await _create_customer(client, 8001)
    await _add_extension(client, 8001, "101")

    app.state.engine.initiate_callback = AsyncMock(
        return_value={"call_id": "CS-cb-001", "status": "queued"}
    )

    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={
            "vs_customer_id": 8001,
            "extension": "101",
            "destination_number": "+12125550100",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CS-cb-001"
    assert body["status"] == "queued"
    app.state.engine.initiate_callback.assert_awaited_once()
    call_kwargs = app.state.engine.initiate_callback.call_args
    assert call_kwargs.kwargs["contact_number"] == "+12125550100"
    assert "callback-answered" in call_kwargs.kwargs["webhook_url"]


# ---------------------------------------------------------------------------
# POST /Callback/ByExtension — error paths
# ---------------------------------------------------------------------------


async def test_callback_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={"vs_customer_id": 99990, "extension": "101", "destination_number": "+12125550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_callback_unknown_extension_returns_404(client) -> None:
    await _create_customer(client, 8002)
    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={"vs_customer_id": 8002, "extension": "999", "destination_number": "+12125550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Extension not found"


async def test_callback_engine_error_returns_502(client) -> None:
    from app.main import app

    await _create_customer(client, 8003)
    await _add_extension(client, 8003, "201")

    app.state.engine.initiate_callback = AsyncMock(side_effect=RuntimeError("Jambonz unavailable"))

    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={"vs_customer_id": 8003, "extension": "201", "destination_number": "+12125550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Call engine error"


# ---------------------------------------------------------------------------
# POST /webhooks/jambonz/callback-answered
# ---------------------------------------------------------------------------


async def test_callback_answered_returns_dial_verb(client) -> None:
    """When the agent answers, the webhook returns a dial verb for the contact."""
    call_sid = "CS-answered-001"
    contact = "+13335550100"

    async with pending_callbacks_lock:
        pending_callbacks[call_sid] = contact

    resp = await client.post(
        _CB_ANSWERED,
        json={"call_sid": call_sid, "from": "+17771110000"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "dial"
    assert verbs[0]["target"][0]["number"] == contact

    # State entry should be consumed
    async with pending_callbacks_lock:
        assert call_sid not in pending_callbacks


async def test_callback_answered_unknown_call_sid_returns_empty(client) -> None:
    """No pending state for the call_sid: return empty verb array."""
    resp = await client.post(
        _CB_ANSWERED,
        json={"call_sid": "CS-no-state", "from": "+17771110000"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_callback_answered_invalid_json_returns_400(client) -> None:
    resp = await client.post(
        _CB_ANSWERED,
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
