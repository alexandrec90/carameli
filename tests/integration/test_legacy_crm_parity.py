"""LegacyCRM contract parity tests.

Each test references the legacy source file that defines the original CMV/ASMX contract.
Payload/response assertions focus on practical compatibility semantics in Carameli.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_customer(client, vs_customer_id: int, api_key: str) -> dict:
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": vs_customer_id, "api_key": api_key},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


async def _add_phone_line(client, vs_customer_id: int, phone_number: str, sid: str) -> dict:
    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": sid, "phone_number": phone_number}
    )

    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": vs_customer_id, "area_code": "550"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


# ── SMS contract (LegacyCRM: the legacy SMS backend SendSMS) ─────────────


async def test_sms_send_compatibility_route_and_response_shape(client) -> None:
    """Carameli keeps the CMV route pattern /VsMessaging/Sms/Send/{customerId}."""
    from app.main import app

    await _create_customer(client, 5501, "key-5501")
    await _add_phone_line(client, 5501, "+15501550001", "PNvl001")
    app.state.carrier.send_sms = AsyncMock(return_value={"sid": "SMvl001", "status": "queued"})

    resp = await client.post(
        "/vsapi/1.0.0/VsMessaging/Sms/Send/5501",
        json={
            "from_number": "+15501550001",
            "to_number": "+14155550099",
            "body": "Hello from parity test",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["message_sid"] == "SMvl001"


async def test_sms_send_legacy_field_names_rejected_as_invalid_input(client) -> None:
    """Legacy JSON keys (from/to/text/referenceId) should fail as invalid input (422)."""
    await _create_customer(client, 5507, "key-5507")

    resp = await client.post(
        "/vsapi/1.0.0/VsMessaging/Sms/Send/5507",
        json={
            "from": "+15507550001",
            "to": "+14155550099",
            "text": "legacy-shape",
            "referenceId": "legacy-ref-1",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 422


# ── Customer provisioning (LegacyCRM: the legacy customer backend) ──────


async def test_customer_create_legacy_crm_required_fields(client) -> None:
    """Legacy flow requires vs_customer_id + api_key-equivalent credentials."""
    data = await _create_customer(client, 5502, "key-5502")

    assert data["vs_customer_id"] == 5502
    assert data["plaintext_key"] == "key-5502"
    uuid.UUID(data["id"])


async def test_customer_create_duplicate_vs_id_returns_409(client) -> None:
    """Duplicate customer IDs should preserve legacy conflict semantics."""
    await _create_customer(client, 5503, "key-5503a")

    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 5503, "api_key": "key-5503b"},
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 409


# ── Call status webhook (LegacyCRM: CMVCallInfo.asmx NotifyIncomingCall) ───


async def test_call_status_webhook_legacy_crm_payload_semantics(client, monkeypatch) -> None:
    """Call status payload with identifier/status fields should be accepted."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "jambonz_webhook_secret", "")

    resp = await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CAvl001",
            "call_status": "completed",
            "duration": "120",
            "from": "+14155550001",
            "to": "+14155550002",
        },
    )

    assert resp.status_code == 200
    assert resp.json().get("status") == "ok"


# ── Callback contract (LegacyCRM: the legacy callback backend) ───────────


async def test_callback_by_extension_contract_semantics(client) -> None:
    """Callback endpoint returns call_sid/status comparable to legacy callback status."""
    from app.main import app

    await _create_customer(client, 5504, "key-5504")
    ext_resp = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={"vs_customer_id": 5504, "extension_number": "201"},
        headers=AUTH_HEADERS,
    )
    assert ext_resp.status_code == 201

    app.state.engine.initiate_callback = AsyncMock(
        return_value={"call_id": "CBvl001", "status": "queued"}
    )

    resp = await client.post(
        "/vsapi/1.0.0/Callback/ByExtension",
        json={
            "vs_customer_id": 5504,
            "extension": "201",
            "destination_number": "+14155550123",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["call_sid"] == "CBvl001"
    assert data["status"] == "queued"


# ── Phone line lifecycle (LegacyCRM: the legacy phone-number backend) ─────


async def test_phone_line_lifecycle_add_count_deactivate(client) -> None:
    """Carameli phone-line add/count/deactivate mirrors CMV lifecycle semantics."""
    from app.main import app

    await _create_customer(client, 5505, "key-5505")

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15505550077"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNvl005", "phone_number": "+15505550077"}
    )

    add_resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 5505, "area_code": "550"},
        headers=AUTH_HEADERS,
    )
    assert add_resp.status_code == 201
    line = add_resp.json()
    assert line["phone_number"] == "+15505550077"
    assert line["provider_sid"] == "PNvl005"
    assert line["active"] is True

    count_resp = await client.get("/vsapi/1.0.0/PhoneLine/GetCount/5505", headers=AUTH_HEADERS)
    assert count_resp.status_code == 200
    count_data = count_resp.json()
    assert count_data["vs_customer_id"] == 5505
    assert count_data["count"] == 1

    app.state.carrier.release_number = AsyncMock(return_value=None)
    deact_resp = await client.put(
        "/vsapi/1.0.0/PhoneLine/Deactivate",
        json={"vs_customer_id": 5505, "phone_number": "+15505550077"},
        headers=AUTH_HEADERS,
    )

    assert deact_resp.status_code == 200
    assert deact_resp.json()["active"] is False


async def test_extension_add_shape_for_legacy_extension_workflow(client) -> None:
    """Extension creation returns identifier fields legacy clients depend on."""
    await _create_customer(client, 5506, "key-5506")

    resp = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={"vs_customer_id": 5506, "extension_number": "333"},
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["extension_number"] == "333"
    assert data["active"] is True
    assert "sip_username" in data
