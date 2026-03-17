from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_DROP_URL = "/vsapi/1.0.0/VsMessageDrop"

_VALID_PAYLOAD = {
    "vs_customer_id": 8200,
    "extension": "+14155550100",
    "msg_drop_number": "+12125550199",
    "audio_url": "https://cdn.example.com/drop.mp3",
}


async def _create_customer(client, vs_id: int) -> dict:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


async def test_voicemail_drop_happy_path(client) -> None:
    """Customer exists and engine succeeds — should return 200 with call_sid + status."""
    await _create_customer(client, 8200)

    from app.main import app

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_sid": "CAvm8200", "status": "queued"}
    )

    resp = await client.post(_DROP_URL, json=_VALID_PAYLOAD, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CAvm8200"
    assert body["status"] == "queued"


async def test_voicemail_drop_customer_not_found_returns_404(client) -> None:
    """Unknown vs_customer_id should return 404."""
    resp = await client.post(
        _DROP_URL,
        json={**_VALID_PAYLOAD, "vs_customer_id": 99980},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_voicemail_drop_engine_error_returns_502(client) -> None:
    """When the engine raises, should return 502."""
    await _create_customer(client, 8201)

    from app.main import app

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        side_effect=Exception("Jambonz unreachable")
    )

    resp = await client.post(
        _DROP_URL,
        json={**_VALID_PAYLOAD, "vs_customer_id": 8201},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502
    assert "Provider error" in resp.json()["detail"]


async def test_voicemail_drop_no_auth_returns_401(client) -> None:
    """Missing Authorization header should return 401."""
    resp = await client.post(_DROP_URL, json=_VALID_PAYLOAD)
    assert resp.status_code == 401


async def test_voicemail_drop_cross_customer_returns_403(client) -> None:
    """A customer-scoped token may not drop calls for a different customer."""
    await _create_customer(client, 8202)
    await _create_customer(client, 8203)

    resp = await client.post(
        _DROP_URL,
        # token belongs to 8202, but payload targets 8203
        json={**_VALID_PAYLOAD, "vs_customer_id": 8203},
        headers={"Authorization": "Bearer key-8202"},
    )
    assert resp.status_code == 403
