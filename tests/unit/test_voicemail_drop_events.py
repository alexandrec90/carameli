from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.main import app
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_DROP_BASE = "/vsapi/1.0.0/VsMailboxDrop"
_MSG_DROP = "/vsapi/1.0.0/VsMessageDrop"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _initiate_drop(client, vs_id: int, to_number: str = "+15550001111") -> dict:
    resp = await client.post(
        _MSG_DROP,
        json={
            "vs_customer_id": vs_id,
            "msg_drop_number": to_number,
            "extension": "+15550001234",
            "audio_url": "https://example.com/audio.mp3",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_list_drop_events_empty(client) -> None:
    await _create_customer(client, 8601)
    resp = await client.get(f"{_DROP_BASE}/List/8601", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 8601
    assert body["events"] == []


async def test_list_drop_events_customer_not_found(client) -> None:
    resp = await client.get(f"{_DROP_BASE}/List/799801", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_voicemail_drop_persists_event(client) -> None:
    await _create_customer(client, 8602)
    app.state.engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_id": "call-abc", "status": "initiated"}
    )

    await _initiate_drop(client, 8602, to_number="+15550002222")

    resp = await client.get(f"{_DROP_BASE}/List/8602", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["to_number"] == "+15550002222"
    assert events[0]["call_sid"] == "call-abc"
    assert events[0]["status"] == "initiated"


async def test_list_drop_events_isolated_per_customer(client) -> None:
    await _create_customer(client, 8603)
    await _create_customer(client, 8604)

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_id": "call-xyz", "status": "initiated"}
    )
    await _initiate_drop(client, 8603)

    resp = await client.get(f"{_DROP_BASE}/List/8604", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["events"] == []


async def test_list_drop_events_multiple(client) -> None:
    await _create_customer(client, 8605)

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_id": "call-1", "status": "initiated"}
    )
    await _initiate_drop(client, 8605, to_number="+15550003333")

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_id": "call-2", "status": "initiated"}
    )
    await _initiate_drop(client, 8605, to_number="+15550004444")

    resp = await client.get(f"{_DROP_BASE}/List/8605", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert len(resp.json()["events"]) == 2
