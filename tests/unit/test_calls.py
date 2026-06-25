from __future__ import annotations

import uuid

import pytest

from app.repositories.call_event_repo import CallEventRepo
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_CALL_BASE = "/vsapi/1.0.0/VsCall"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _seed_event(db_session, customer_id: uuid.UUID, call_sid: str) -> None:
    await CallEventRepo(db_session).create_from_webhook(
        customer_id=customer_id,
        payload={
            "CallSid": call_sid,
            "CallStatus": "completed",
            "From": "+14155550000",
            "To": "+14155550001",
            "CallDuration": "30",
            "Direction": "inbound",
        },
    )


async def test_list_call_events_returns_customer_events(client, db_session) -> None:
    customer_id = await _create_customer(client, 6001)
    await _seed_event(db_session, customer_id, "CAlist6001a")
    await _seed_event(db_session, customer_id, "CAlist6001b")

    resp = await client.get(f"{_CALL_BASE}/List/6001", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 6001
    assert {e["call_sid"] for e in body["events"]} == {"CAlist6001a", "CAlist6001b"}


async def test_list_call_events_empty(client) -> None:
    await _create_customer(client, 6002)
    resp = await client.get(f"{_CALL_BASE}/List/6002", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["events"] == []


async def test_list_call_events_isolated_per_customer(client, db_session) -> None:
    customer_a = await _create_customer(client, 6003)
    await _create_customer(client, 6004)
    await _seed_event(db_session, customer_a, "CAlist6003a")

    resp = await client.get(f"{_CALL_BASE}/List/6004", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["events"] == []


async def test_list_call_events_date_range_filters(client, db_session) -> None:
    customer_id = await _create_customer(client, 6005)
    await _seed_event(db_session, customer_id, "CAlist6005a")

    # An end bound before the call's started_at excludes everything.
    past = await client.get(
        f"{_CALL_BASE}/List/6005", params={"end": "2000-01-01T00:00:00"}, headers=AUTH_HEADERS
    )
    assert past.status_code == 200
    assert past.json()["events"] == []

    # A start bound far in the past includes the event.
    included = await client.get(
        f"{_CALL_BASE}/List/6005", params={"start": "2000-01-01T00:00:00"}, headers=AUTH_HEADERS
    )
    assert included.status_code == 200
    assert {e["call_sid"] for e in included.json()["events"]} == {"CAlist6005a"}


async def test_list_call_events_customer_not_found(client) -> None:
    resp = await client.get(f"{_CALL_BASE}/List/699999", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_get_recording_not_found(client) -> None:
    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CAmissing001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Call not found"


async def test_get_recording_no_recording(client) -> None:
    await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CAnorecording001",
            "call_status": "completed",
            "from": "+14155550000",
            "to": "+14155550001",
            "duration": "12",
        },
    )

    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CAnorecording001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No recording for this call"


async def test_get_recording_success(client) -> None:
    await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CArecording001",
            "call_status": "completed",
            "from": "+14155550000",
            "to": "+14155550001",
            "duration": "120",
            "recording_url": "https://recordings.example.com/RErecording001",
        },
    )

    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CArecording001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CArecording001"
    assert body["recording_url"] == "https://recordings.example.com/RErecording001"
    assert body["duration_seconds"] == 120
