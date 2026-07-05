from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.repositories.sms_message_repo import SmsMessageRepo
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_SMS_BASE = "/vsapi/1.0.0/VsMessaging/Sms"


async def _setup(client, vs_id: int, phone_number: str) -> None:
    """Create a customer and a phone line with carrier/engine mocks."""
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
    }
    await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNtest{vs_id}", "phone_number": phone_number}
    )
    app.state.carrier.enable_sms = AsyncMock(return_value=None)
    app.state.carrier.disable_sms = AsyncMock(return_value=None)
    app.state.carrier.send_sms = AsyncMock(
        return_value={"provider_sid": f"SMtest{vs_id}", "status": "sent"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "area_code": "600"},
        headers=AUTH_HEADERS,
    )


async def test_sms_enable(client) -> None:
    await _setup(client, 6001, "+16015550100")
    encoded = "%2B16015550100"
    resp = await client.put(f"{_SMS_BASE}/Enable/6001/{encoded}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["sms_enabled"] is True


async def test_sms_send(client) -> None:
    await _setup(client, 6002, "+16025550100")
    encoded = "%2B16025550100"
    await client.put(f"{_SMS_BASE}/Enable/6002/{encoded}", headers=AUTH_HEADERS)

    resp = await client.post(
        f"{_SMS_BASE}/Send/6002",
        json={
            "from_number": "+16025550100",
            "to_number": "+15005550001",
            "body": "Hello from test",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


async def test_sms_disable(client) -> None:
    await _setup(client, 6003, "+16035550100")
    encoded = "%2B16035550100"
    await client.put(f"{_SMS_BASE}/Enable/6003/{encoded}", headers=AUTH_HEADERS)

    resp = await client.put(f"{_SMS_BASE}/Disable/6003/{encoded}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["sms_enabled"] is False


# ---------------------------------------------------------------------------
# Auth rejection
# ---------------------------------------------------------------------------


async def test_sms_enable_no_auth_returns_401(client) -> None:
    resp = await client.put(f"{_SMS_BASE}/Enable/6004/%2B16045550100")
    assert resp.status_code == 401


async def test_sms_send_no_auth_returns_401(client) -> None:
    resp = await client.post(
        f"{_SMS_BASE}/Send/6004",
        json={"from_number": "+16045550100", "to_number": "+15005550001", "body": "Hi"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Customer not found (404)
# ---------------------------------------------------------------------------


async def test_sms_enable_unknown_customer_returns_404(client) -> None:
    resp = await client.put(f"{_SMS_BASE}/Enable/99910/%2B10000000000", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_sms_disable_unknown_customer_returns_404(client) -> None:
    resp = await client.put(f"{_SMS_BASE}/Disable/99911/%2B10000000000", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_sms_send_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        f"{_SMS_BASE}/Send/99912",
        json={"from_number": "+16045550100", "to_number": "+15005550001", "body": "Hi"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


# ---------------------------------------------------------------------------
# Phone line not found (404)
# ---------------------------------------------------------------------------


async def test_sms_enable_unknown_line_returns_404(client) -> None:
    """Customer exists but the number has no phone line record."""
    await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": 6010, "api_key": "key-6010"},
        headers=AUTH_HEADERS,
    )
    resp = await client.put(f"{_SMS_BASE}/Enable/6010/%2B10000000001", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"


async def test_sms_disable_unknown_line_returns_404(client) -> None:
    await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": 6011, "api_key": "key-6011"},
        headers=AUTH_HEADERS,
    )
    resp = await client.put(f"{_SMS_BASE}/Disable/6011/%2B10000000002", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"


# ---------------------------------------------------------------------------
# Carrier provider errors (502)
# ---------------------------------------------------------------------------


async def test_sms_enable_carrier_error_returns_502(client) -> None:
    await _setup(client, 6020, "+16205550100")

    from app.main import app

    app.state.carrier.enable_sms = AsyncMock(side_effect=Exception("Telnyx down"))

    encoded = "%2B16205550100"
    resp = await client.put(f"{_SMS_BASE}/Enable/6020/{encoded}", headers=AUTH_HEADERS)
    assert resp.status_code == 502


async def test_sms_disable_carrier_error_returns_502(client) -> None:
    await _setup(client, 6021, "+16215550100")

    from app.main import app

    # Enable first so the line exists
    app.state.carrier.enable_sms = AsyncMock(return_value=None)
    encoded = "%2B16215550100"
    await client.put(f"{_SMS_BASE}/Enable/6021/{encoded}", headers=AUTH_HEADERS)

    app.state.carrier.disable_sms = AsyncMock(side_effect=Exception("Telnyx down"))
    resp = await client.put(f"{_SMS_BASE}/Disable/6021/{encoded}", headers=AUTH_HEADERS)
    assert resp.status_code == 502


async def test_sms_send_carrier_error_returns_502(client) -> None:
    await _setup(client, 6022, "+16225550100")

    from app.main import app

    app.state.carrier.send_sms = AsyncMock(side_effect=Exception("Telnyx down"))

    resp = await client.post(
        f"{_SMS_BASE}/Send/6022",
        json={
            "from_number": "+16225550100",
            "to_number": "+15005550001",
            "body": "Test",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# International SMS block (Feature 2 — mirrors CmvSmsProvider.cs line 220)
# ---------------------------------------------------------------------------


async def test_sms_send_international_number_returns_400(client) -> None:
    """to_number not starting with +1 must be rejected before any DB or carrier call."""
    await _setup(client, 6030, "+16305550100")

    resp = await client.post(
        f"{_SMS_BASE}/Send/6030",
        json={
            "from_number": "+16305550100",
            "to_number": "+442071234567",
            "body": "Hello UK",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "International SMS is not supported"


async def test_sms_send_international_number_carrier_not_called(client) -> None:
    """Carrier send_sms must not be invoked when to_number is international."""
    await _setup(client, 6031, "+16315550100")

    from app.main import app

    app.state.carrier.send_sms = AsyncMock()

    await client.post(
        f"{_SMS_BASE}/Send/6031",
        json={
            "from_number": "+16315550100",
            "to_number": "+49301234567",
            "body": "Hello Germany",
        },
        headers=AUTH_HEADERS,
    )
    app.state.carrier.send_sms.assert_not_awaited()


async def test_sms_send_us_number_accepted(client) -> None:
    """to_number starting with +1 passes the international check."""
    await _setup(client, 6032, "+16325550100")

    resp = await client.post(
        f"{_SMS_BASE}/Send/6032",
        json={
            "from_number": "+16325550100",
            "to_number": "+12125550199",
            "body": "Domestic OK",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


# ---------------------------------------------------------------------------
# List SMS messages (Plan A — mirrors VsCall/List)
# ---------------------------------------------------------------------------


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _seed_message(db_session, customer_id: uuid.UUID, message_sid: str) -> None:
    await SmsMessageRepo(db_session).create(
        customer_id=customer_id,
        phone_line_id=None,
        message_sid=message_sid,
        direction="outbound",
        from_number="+14155550000",
        to_number="+14155550001",
        body="hi",
        delivery_status="delivered",
    )


async def test_list_sms_messages_returns_customer_messages(client, db_session) -> None:
    customer_id = await _create_customer(client, 6101)
    await _seed_message(db_session, customer_id, "SMlist6101a")
    await _seed_message(db_session, customer_id, "SMlist6101b")

    resp = await client.get(f"{_SMS_BASE}/List/6101", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 6101
    assert {m["message_sid"] for m in body["messages"]} == {"SMlist6101a", "SMlist6101b"}


async def test_list_sms_messages_empty(client) -> None:
    await _create_customer(client, 6102)
    resp = await client.get(f"{_SMS_BASE}/List/6102", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["messages"] == []


async def test_list_sms_messages_isolated_per_customer(client, db_session) -> None:
    customer_a = await _create_customer(client, 6103)
    await _create_customer(client, 6104)
    await _seed_message(db_session, customer_a, "SMlist6103a")

    resp = await client.get(f"{_SMS_BASE}/List/6104", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["messages"] == []


async def test_list_sms_messages_date_range_filters(client, db_session) -> None:
    customer_id = await _create_customer(client, 6105)
    await _seed_message(db_session, customer_id, "SMlist6105a")

    # An end bound before the message's created_at excludes everything.
    past = await client.get(
        f"{_SMS_BASE}/List/6105", params={"end": "2000-01-01T00:00:00"}, headers=AUTH_HEADERS
    )
    assert past.status_code == 200
    assert past.json()["messages"] == []

    # A start bound far in the past includes the message.
    included = await client.get(
        f"{_SMS_BASE}/List/6105", params={"start": "2000-01-01T00:00:00"}, headers=AUTH_HEADERS
    )
    assert included.status_code == 200
    assert {m["message_sid"] for m in included.json()["messages"]} == {"SMlist6105a"}


async def test_list_sms_messages_customer_not_found(client) -> None:
    resp = await client.get(f"{_SMS_BASE}/List/699999", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"
