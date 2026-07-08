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


async def _seed_event_full(
    db_session,
    customer_id: uuid.UUID,
    call_sid: str,
    *,
    status: str,
    duration: str,
    direction: str = "inbound",
    extension: str = "101",
    from_number: str = "+14155550000",
    to_number: str = "+14155550001",
) -> None:
    await CallEventRepo(db_session).create_from_webhook(
        customer_id=customer_id,
        payload={
            "CallSid": call_sid,
            "CallStatus": status,
            "From": from_number,
            "To": to_number,
            "CallDuration": duration,
            "Direction": direction,
            "Extension": extension,
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


async def test_call_summary_groups_by_extension_with_metrics(client, db_session) -> None:
    customer_id = await _create_customer(client, 6100)
    # ext 101: two calls, one completed (60s), one failed (0s) -> 50% success, avg 30s
    await _seed_event_full(
        db_session, customer_id, "CAsum6100a", status="completed", duration="60", extension="101"
    )
    await _seed_event_full(
        db_session, customer_id, "CAsum6100b", status="failed", duration="0", extension="101"
    )
    # ext 202: one completed call (120s)
    await _seed_event_full(
        db_session, customer_id, "CAsum6100c", status="completed", duration="120", extension="202"
    )

    resp = await client.get(f"{_CALL_BASE}/Summary/6100", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["group_by"] == "extension"
    assert body["vs_customer_id"] == 6100
    by_key = {r["group_key"]: r for r in body["summary"]}
    assert by_key["101"]["call_count"] == 2
    assert by_key["101"]["answered_count"] == 1
    assert by_key["101"]["total_duration_seconds"] == 60
    assert by_key["101"]["avg_duration_seconds"] == 30.0
    assert by_key["101"]["success_rate"] == 0.5
    assert by_key["202"]["call_count"] == 1
    assert by_key["202"]["success_rate"] == 1.0


async def test_call_summary_groups_by_number_uses_customer_facing_did(client, db_session) -> None:
    customer_id = await _create_customer(client, 6101)
    # Inbound: customer DID is the To number.
    await _seed_event_full(
        db_session,
        customer_id,
        "CAsum6101a",
        status="completed",
        duration="30",
        direction="inbound",
        to_number="+14155551111",
    )
    # Outbound: customer DID is the From number.
    await _seed_event_full(
        db_session,
        customer_id,
        "CAsum6101b",
        status="completed",
        duration="30",
        direction="outbound",
        from_number="+14155552222",
    )

    resp = await client.get(
        f"{_CALL_BASE}/Summary/6101", params={"group_by": "number"}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    keys = {r["group_key"] for r in resp.json()["summary"]}
    assert keys == {"+14155551111", "+14155552222"}


async def test_call_summary_isolated_per_customer(client, db_session) -> None:
    customer_a = await _create_customer(client, 6102)
    await _create_customer(client, 6103)
    await _seed_event_full(db_session, customer_a, "CAsum6102a", status="completed", duration="30")

    resp = await client.get(f"{_CALL_BASE}/Summary/6103", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["summary"] == []


async def test_call_summary_date_range_filters(client, db_session) -> None:
    customer_id = await _create_customer(client, 6104)
    await _seed_event_full(db_session, customer_id, "CAsum6104a", status="completed", duration="30")

    excluded = await client.get(
        f"{_CALL_BASE}/Summary/6104", params={"end": "2000-01-01T00:00:00"}, headers=AUTH_HEADERS
    )
    assert excluded.status_code == 200
    assert excluded.json()["summary"] == []

    included = await client.get(
        f"{_CALL_BASE}/Summary/6104", params={"start": "2000-01-01T00:00:00"}, headers=AUTH_HEADERS
    )
    assert included.status_code == 200
    assert len(included.json()["summary"]) == 1


async def test_call_summary_customer_not_found(client) -> None:
    resp = await client.get(f"{_CALL_BASE}/Summary/699998", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_call_summary_rejects_unknown_group_by(client) -> None:
    await _create_customer(client, 6105)
    resp = await client.get(
        f"{_CALL_BASE}/Summary/6105", params={"group_by": "carrier"}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 422


async def test_get_existing_call_sids_batches_lookup(client, db_session) -> None:
    """get_existing_call_sids returns only the sids that have a call_events row."""
    customer_id = await _create_customer(client, 6200)
    await _seed_event(db_session, customer_id, "CAexist6200a")
    await _seed_event(db_session, customer_id, "CAexist6200b")

    repo = CallEventRepo(db_session)
    result = await repo.get_existing_call_sids(["CAexist6200a", "CAexist6200b", "CAnever6200"])

    assert result == {"CAexist6200a", "CAexist6200b"}
    assert await repo.get_existing_call_sids([]) == set()


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
    # The API returns the Carameli-served URL, not the raw provider URL.
    from app.services import recording_links

    assert body["recording_url"] == recording_links.public_recording_url("CArecording001")
    assert body["duration_seconds"] == 120
