"""Integration tests: multi-step flows that cross multiple tables/endpoints.

These use the same fixtures as the unit tests (real PostgreSQL, mocked
carrier/engine at the app.state boundary).  The goal is to catch bugs that
only appear when several operations run in sequence — FK violations, stale
session state, cascade issues, etc.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.repositories.phone_line_repo import PhoneLineRepo
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST = "/vsapi/1.0.0/VsCustomer"
_LINE = "/vsapi/1.0.0/PhoneLine"
_SMS = "/vsapi/1.0.0/VsMessaging/Sms"
_EXT = "/vsapi/1.0.0/VsExtension"
_ADD_PTR = "/vsapi/1.0.0/AddPointerToExtension"
_DEL_PTR = "/vsapi/1.0.0/DeletePointerToExtension"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_customer(client, vs_id: int) -> dict:
    resp = await client.post(
        f"{_CUST}/Create",
        json={
            "vs_customer_id": vs_id,
            "api_key": f"key-{vs_id}",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


def _mock_carrier_provision(app, phone_number: str, sid: str) -> None:
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": sid, "phone_number": phone_number}
    )
    app.state.carrier.release_number = AsyncMock(return_value=None)
    app.state.carrier.enable_sms = AsyncMock(return_value=None)
    app.state.carrier.disable_sms = AsyncMock(return_value=None)
    app.state.carrier.send_sms = AsyncMock(return_value={"sid": f"SM{sid}", "status": "sent"})


# ---------------------------------------------------------------------------
# Flow 1: Customer → DID → SMS full lifecycle
# ---------------------------------------------------------------------------


async def test_customer_did_sms_full_flow(client) -> None:
    """Create customer → add DID → enable SMS → send SMS → disable SMS."""
    from app.main import app

    await _create_customer(client, 9001)
    _mock_carrier_provision(app, "+19015550100", "PNflow9001")

    # Add DID
    add_resp = await client.post(
        f"{_LINE}/Add",
        json={"vs_customer_id": 9001, "area_code": "901"},
        headers=AUTH_HEADERS,
    )
    assert add_resp.status_code == 201
    assert add_resp.json()["phone_number"] == "+19015550100"

    encoded = "%2B19015550100"

    # Enable SMS
    en_resp = await client.put(f"{_SMS}/Enable/9001/{encoded}", headers=AUTH_HEADERS)
    assert en_resp.status_code == 200
    assert en_resp.json()["sms_enabled"] is True

    # Send SMS
    send_resp = await client.post(
        f"{_SMS}/Send/9001",
        json={
            "from_number": "+19015550100",
            "to_number": "+15005550001",
            "body": "hi",
        },
        headers=AUTH_HEADERS,
    )
    assert send_resp.status_code == 200
    assert send_resp.json()["success"] is True

    # Disable SMS
    dis_resp = await client.put(f"{_SMS}/Disable/9001/{encoded}", headers=AUTH_HEADERS)
    assert dis_resp.status_code == 200
    assert dis_resp.json()["sms_enabled"] is False


# ---------------------------------------------------------------------------
# Flow 2: DID lifecycle — add, deactivate, verify GetPhoneLines shows none
# ---------------------------------------------------------------------------


async def test_did_add_deactivate_then_get_returns_empty(client) -> None:
    """Add a DID then deactivate it; GetPhoneLines should return an empty list."""
    from app.main import app

    await _create_customer(client, 9002)
    _mock_carrier_provision(app, "+19025550100", "PNflow9002")

    await client.post(
        f"{_LINE}/Add",
        json={"vs_customer_id": 9002, "area_code": "902"},
        headers=AUTH_HEADERS,
    )

    deact_resp = await client.put(
        f"{_LINE}/Deactivate",
        json={"vs_customer_id": 9002, "phone_number": "+19025550100"},
        headers=AUTH_HEADERS,
    )
    assert deact_resp.status_code == 200
    assert deact_resp.json()["active"] is False

    lines_resp = await client.get(f"{_CUST}/GetPhoneLines/9002", headers=AUTH_HEADERS)
    assert lines_resp.status_code == 200
    assert lines_resp.json() == []

    count_resp = await client.get(f"{_LINE}/GetCount/9002", headers=AUTH_HEADERS)
    assert count_resp.json()["count"] == 0


# ---------------------------------------------------------------------------
# Flow 3: Extension + pointer full lifecycle
# ---------------------------------------------------------------------------


async def test_extension_pointer_lifecycle(client, db_session) -> None:
    """Create customer → add extension via API → seed DID via repo.

    Then add a pointer and delete it.
    """

    data = await _create_customer(client, 9003)
    customer_id = uuid.UUID(data["id"])

    # Add extension via API
    ext_resp = await client.post(
        f"{_EXT}/Add",
        json={"vs_customer_id": 9003, "extension_number": "600"},
        headers=AUTH_HEADERS,
    )
    assert ext_resp.status_code == 201

    # Seed phone line directly (avoids carrier mock complexity)
    line_repo = PhoneLineRepo(db_session)
    await line_repo.create(
        customer_id=customer_id,
        phone_number="+19035550103",
        provider_sid="PNflow9003",
    )

    pointer_payload = {
        "vs_customer_id": 9003,
        "phone_number": "+19035550103",
        "extension_number": "600",
    }

    # Add pointer
    add_resp = await client.post(_ADD_PTR, json=pointer_payload, headers=AUTH_HEADERS)
    assert add_resp.status_code == 200
    assert add_resp.json()["success"] is True

    # Delete pointer
    del_resp = await client.request("DELETE", _DEL_PTR, json=pointer_payload, headers=AUTH_HEADERS)
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True

    # Second delete should 404 (pointer no longer exists)
    del_again = await client.request("DELETE", _DEL_PTR, json=pointer_payload, headers=AUTH_HEADERS)
    assert del_again.status_code == 404


# ---------------------------------------------------------------------------
# Flow 4: Multiple DIDs — GetPhoneLines only returns active ones
# ---------------------------------------------------------------------------


async def test_get_phone_lines_filters_inactive(client, db_session) -> None:
    """Seed two lines directly; deactivate one; GetPhoneLines returns only the active one."""
    data = await _create_customer(client, 9004)
    customer_id = uuid.UUID(data["id"])

    line_repo = PhoneLineRepo(db_session)
    await line_repo.create(
        customer_id=customer_id,
        phone_number="+19045550001",
        provider_sid="PNflow9004a",
    )
    inactive_line = await line_repo.create(
        customer_id=customer_id,
        phone_number="+19045550002",
        provider_sid="PNflow9004b",
    )
    await line_repo.deactivate(inactive_line)

    resp = await client.get(f"{_CUST}/GetPhoneLines/9004", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    numbers = [item["phone_number"] for item in resp.json()]
    assert "+19045550001" in numbers
    assert "+19045550002" not in numbers


# ---------------------------------------------------------------------------
# Flow 5: Webhook → call event → verify DB state
# ---------------------------------------------------------------------------


async def test_webhook_then_query_call_event(client, db_session) -> None:
    """POST a call-status webhook, then verify the DB row has correct fields."""
    from app.repositories.call_event_repo import CallEventRepo

    payload = {
        "call_sid": "CAintegration9005",
        "call_status": "completed",
        "direction": "outbound",
        "from": "+19055550000",
        "to": "+19055550001",
        "duration": "62",
        "recording_url": "https://recordings.example.com/CAintegration9005",
    }
    resp = await client.post("/webhooks/jambonz/call-status", json=payload)
    assert resp.status_code == 200

    repo = CallEventRepo(db_session)
    event = await repo.get_by_call_sid("CAintegration9005")
    assert event is not None
    assert event.status == "completed"
    assert event.duration_seconds == 62
    assert event.recording_url == "https://recordings.example.com/CAintegration9005"
    assert event.from_number == "+19055550000"
    assert event.to_number == "+19055550001"
