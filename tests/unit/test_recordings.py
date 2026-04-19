"""Tests for the CallRecordings export endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_REC_BASE = "/vsapi/1.0.0/CallRecordings"
_WEBHOOK_JAMBONZ = "/webhooks/jambonz/call-status"


async def _create_customer_with_line(client, vs_id: int, phone_number: str) -> None:
    """Create a customer and a phone line so Jambonz webhooks resolve customer_id."""
    await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-rec-{vs_id}"},
        headers=AUTH_HEADERS,
    )

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": f"PNrec{vs_id}", "phone_number": phone_number}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "area_code": "800"},
        headers=AUTH_HEADERS,
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_recording_export_returns_download_url(client) -> None:
    """Export endpoint returns download_url when recording_url is stored on the call event."""
    vs_id = 8001
    phone = "+18015550100"
    call_sid = "CAexport001"
    recording_url = "https://recordings.example.com/REexport001.mp3"

    await _create_customer_with_line(client, vs_id, phone)

    # Jambonz fires a call-status event; the `to` number resolves to the customer.
    await client.post(
        _WEBHOOK_JAMBONZ,
        json={
            "call_sid": call_sid,
            "call_status": "completed",
            "from": "+12125550000",
            "to": phone,
            "duration": "60",
            "recording_url": recording_url,
        },
    )

    resp = await client.get(
        f"{_REC_BASE}/Export/{vs_id}/{call_sid}",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == call_sid
    assert body["download_url"] == recording_url


# ---------------------------------------------------------------------------
# 404 paths
# ---------------------------------------------------------------------------


async def test_recording_export_no_recording_url_returns_404(client) -> None:
    """If the call event has no recording_url the endpoint must return 404."""
    vs_id = 8002
    phone = "+18025550100"
    call_sid = "CAexport002"

    await _create_customer_with_line(client, vs_id, phone)

    await client.post(
        _WEBHOOK_JAMBONZ,
        json={
            "call_sid": call_sid,
            "call_status": "completed",
            "from": "+12125550001",
            "to": phone,
            "duration": "30",
        },
    )

    resp = await client.get(
        f"{_REC_BASE}/Export/{vs_id}/{call_sid}",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No recording available"


async def test_recording_export_unknown_call_returns_404(client) -> None:
    """Export for a call_sid that does not exist must return 404."""
    vs_id = 8003
    await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-rec-{vs_id}"},
        headers=AUTH_HEADERS,
    )

    resp = await client.get(
        f"{_REC_BASE}/Export/{vs_id}/CAnonexistent999",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Call not found"


async def test_recording_export_wrong_customer_returns_404(client) -> None:
    """Export must not return a recording that belongs to a different customer."""
    vs_id_a = 8004
    vs_id_b = 8005
    phone_a = "+18045550100"
    call_sid = "CAexport004"

    await _create_customer_with_line(client, vs_id_a, phone_a)
    await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id_b, "api_key": f"key-rec-{vs_id_b}"},
        headers=AUTH_HEADERS,
    )

    # Call event is linked to customer A.
    await client.post(
        _WEBHOOK_JAMBONZ,
        json={
            "call_sid": call_sid,
            "call_status": "completed",
            "from": "+12125550004",
            "to": phone_a,
            "duration": "45",
            "recording_url": "https://recordings.example.com/REexport004.mp3",
        },
    )

    # Customer B tries to access customer A's recording.
    resp = await client.get(
        f"{_REC_BASE}/Export/{vs_id_b}/{call_sid}",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


async def test_recording_export_unknown_customer_returns_404(client) -> None:
    """Export for a non-existent customer must return 404."""
    resp = await client.get(
        f"{_REC_BASE}/Export/99999/CAsomecall",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


async def test_recording_export_no_auth_returns_401(client) -> None:
    resp = await client.get(f"{_REC_BASE}/Export/8001/CAexport001")
    assert resp.status_code == 401
