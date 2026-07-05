"""Tests for SMS message persistence and Telnyx delivery receipt handling."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sms_message import SmsMessage
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_SMS_BASE = "/vsapi/1.0.0/VsMessaging/Sms"
_WEBHOOK_BASE = "/webhooks/telnyx"


async def _setup(client, vs_id: int, phone_number: str, message_sid: str | None = None) -> None:
    """Create a customer, phone line, and mock carrier for SMS tests."""
    await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-sms-{vs_id}"},
        headers=AUTH_HEADERS,
    )

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNsmstest{vs_id}", "phone_number": phone_number}
    )
    app.state.carrier.enable_sms = AsyncMock(return_value=None)
    app.state.carrier.send_sms = AsyncMock(
        return_value={"sid": message_sid or f"SMsmstest{vs_id}", "status": "queued"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "area_code": "700"},
        headers=AUTH_HEADERS,
    )


# ---------------------------------------------------------------------------
# Persist on send
# ---------------------------------------------------------------------------


async def test_sms_send_persists_outbound_row(client, db_session: AsyncSession) -> None:
    """Sending an SMS must create an SmsMessage row with direction='outbound'."""
    sid = "SMpersist001"
    await _setup(client, 7001, "+17015550100", message_sid=sid)
    encoded = "%2B17015550100"
    await client.put(f"{_SMS_BASE}/Enable/7001/{encoded}", headers=AUTH_HEADERS)

    resp = await client.post(
        f"{_SMS_BASE}/Send/7001",
        json={"from_number": "+17015550100", "to_number": "+15005550001", "body": "Hello"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    result = await db_session.execute(select(SmsMessage).where(SmsMessage.message_sid == sid))
    row = result.scalar_one_or_none()
    assert row is not None
    assert row.direction == "outbound"
    assert row.delivery_status == "queued"
    assert row.from_number == "+17015550100"
    assert row.to_number == "+15005550001"
    assert row.body == "Hello"


async def test_sms_send_stores_message_sid(client, db_session: AsyncSession) -> None:
    """The message_sid returned by the carrier must be stored on the row."""
    sid = "SMsid002"
    await _setup(client, 7002, "+17025550100", message_sid=sid)
    encoded = "%2B17025550100"
    await client.put(f"{_SMS_BASE}/Enable/7002/{encoded}", headers=AUTH_HEADERS)

    resp = await client.post(
        f"{_SMS_BASE}/Send/7002",
        json={"from_number": "+17025550100", "to_number": "+15005550002", "body": "Sid check"},
        headers=AUTH_HEADERS,
    )
    assert resp.json()["message_sid"] == sid

    result = await db_session.execute(select(SmsMessage).where(SmsMessage.message_sid == sid))
    assert result.scalar_one_or_none() is not None


async def test_sms_send_carrier_error_does_not_persist(client, db_session: AsyncSession) -> None:
    """If the carrier raises, no SmsMessage row should be created."""
    await _setup(client, 7003, "+17035550100")

    from app.main import app

    app.state.carrier.send_sms = AsyncMock(side_effect=Exception("Telnyx down"))

    await client.put(f"{_SMS_BASE}/Enable/7003/%2B17035550100", headers=AUTH_HEADERS)
    resp = await client.post(
        f"{_SMS_BASE}/Send/7003",
        json={"from_number": "+17035550100", "to_number": "+15005550003", "body": "Fail"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502

    result = await db_session.execute(
        select(SmsMessage).where(SmsMessage.from_number == "+17035550100")
    )
    assert result.scalar_one_or_none() is None


# ---------------------------------------------------------------------------
# Delivery receipt webhook
# ---------------------------------------------------------------------------


async def test_delivery_receipt_updates_status(client, db_session: AsyncSession) -> None:
    """message.finalized webhook must update delivery_status on the SmsMessage row."""
    sid = "SMreceipt001"
    await _setup(client, 7010, "+17105550100", message_sid=sid)
    await client.put(f"{_SMS_BASE}/Enable/7010/%2B17105550100", headers=AUTH_HEADERS)
    await client.post(
        f"{_SMS_BASE}/Send/7010",
        json={"from_number": "+17105550100", "to_number": "+15005550010", "body": "Receipt test"},
        headers=AUTH_HEADERS,
    )

    # Deliver a Telnyx message.finalized event.
    resp = await client.post(
        f"{_WEBHOOK_BASE}/sms-inbound",
        json={
            "data": {
                "event_type": "message.finalized",
                "payload": {
                    "id": sid,
                    "from": {"phone_number": "+17105550100", "status": "delivered"},
                    "to": [{"phone_number": "+15005550010", "status": "delivered"}],
                    "errors": [],
                },
            }
        },
    )
    assert resp.status_code == 204

    result = await db_session.execute(select(SmsMessage).where(SmsMessage.message_sid == sid))
    row = result.scalar_one_or_none()
    assert row is not None
    assert row.delivery_status == "delivered"
    assert row.error_code is None


async def test_delivery_receipt_records_error_code(client, db_session: AsyncSession) -> None:
    """error_code from the Telnyx payload must be stored on the row."""
    sid = "SMreceipt002"
    await _setup(client, 7011, "+17115550100", message_sid=sid)
    await client.put(f"{_SMS_BASE}/Enable/7011/%2B17115550100", headers=AUTH_HEADERS)
    await client.post(
        f"{_SMS_BASE}/Send/7011",
        json={"from_number": "+17115550100", "to_number": "+15005550011", "body": "Error test"},
        headers=AUTH_HEADERS,
    )

    resp = await client.post(
        f"{_WEBHOOK_BASE}/sms-inbound",
        json={
            "data": {
                "event_type": "message.finalized",
                "payload": {
                    "id": sid,
                    "from": {"phone_number": "+17115550100", "status": "failed"},
                    "to": [{"phone_number": "+15005550011", "status": "failed"}],
                    "errors": [{"code": "40001"}],
                },
            }
        },
    )
    assert resp.status_code == 204

    result = await db_session.execute(select(SmsMessage).where(SmsMessage.message_sid == sid))
    row = result.scalar_one_or_none()
    assert row is not None
    assert row.delivery_status == "failed"
    assert row.error_code == "40001"


async def test_delivery_receipt_unknown_sid_returns_204(client) -> None:
    """Delivery receipt for an unknown message_sid must still return 204."""
    resp = await client.post(
        f"{_WEBHOOK_BASE}/sms-inbound",
        json={
            "data": {
                "event_type": "message.finalized",
                "payload": {
                    "id": "SMunknown999",
                    "from": {"phone_number": "+10000000000", "status": "delivered"},
                    "to": [{"phone_number": "+10000000001", "status": "delivered"}],
                    "errors": [],
                },
            }
        },
    )
    assert resp.status_code == 204


async def test_delivery_receipt_missing_id_returns_204(client) -> None:
    """Delivery receipt with no id field must return 204 (graceful no-op)."""
    resp = await client.post(
        f"{_WEBHOOK_BASE}/sms-inbound",
        json={
            "data": {
                "event_type": "message.finalized",
                "payload": {
                    "from": {"phone_number": "+10000000000"},
                    "to": [],
                    "errors": [],
                },
            }
        },
    )
    assert resp.status_code == 204


async def test_inbound_sms_event_still_returns_204(client) -> None:
    """Existing message.received path must remain unaffected."""
    resp = await client.post(
        f"{_WEBHOOK_BASE}/sms-inbound",
        json={
            "data": {
                "event_type": "message.received",
                "payload": {
                    "from": {"phone_number": "+12125550100"},
                    "to": [{"phone_number": "+17005550100"}],
                    "text": "Hello",
                },
            }
        },
    )
    assert resp.status_code == 204
