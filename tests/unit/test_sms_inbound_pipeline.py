"""Tests for the inbound SMS pipeline: persistence, VanillaSoft forwarding,
delivery-receipt forwarding, and the unposted-retry job."""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.sms_message import SmsMessage
from app.services.sms_sync import retry_unposted_sms_messages
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_SMS_BASE = "/vsapi/1.0.0/VsMessaging/Sms"
_WEBHOOK = "/webhooks/telnyx/sms-inbound"


def _inbound_event(
    message_sid: str,
    from_number: str = "+12125550001",
    to_number: str = "+18105550100",
    text: str = "hello agent",
    media: list[dict] | None = None,
) -> dict:
    return {
        "data": {
            "event_type": "message.received",
            "payload": {
                "id": message_sid,
                "from": {"phone_number": from_number},
                "to": [{"phone_number": to_number}],
                "text": text,
                "media": media or [],
            },
        }
    }


def _mock_http(is_success: bool = True, status_code: int = 200) -> AsyncMock:
    response = MagicMock()
    response.is_success = is_success
    response.status_code = status_code
    http = AsyncMock()
    http.__aenter__ = AsyncMock(return_value=http)
    http.__aexit__ = AsyncMock(return_value=False)
    http.post = AsyncMock(return_value=response)
    return http


async def _create_customer_with_line(client, vs_id: int, phone_number: str) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-smsin-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201

    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNsmsin{vs_id}", "phone_number": phone_number}
    )
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "phone_number": phone_number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()


async def _get_message(db_session, message_sid: str) -> SmsMessage | None:
    result = await db_session.execute(
        select(SmsMessage).where(SmsMessage.message_sid == message_sid)
    )
    return result.scalar_one_or_none()


# ── message.received: persistence ──────────────────────────────────────────


async def test_inbound_sms_persisted_and_matched_to_customer(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    phone = "+18105550100"
    await _create_customer_with_line(client, 8601, phone)

    sid = f"SMin{uuid.uuid4().hex[:10]}"
    resp = await client.post(_WEBHOOK, json=_inbound_event(sid, to_number=phone))
    assert resp.status_code == 204

    message = await _get_message(db_session, sid)
    assert message is not None
    assert message.direction == "inbound"
    assert message.from_number == "+12125550001"
    assert message.to_number == phone
    assert message.body == "hello agent"
    assert message.delivery_status == "received"
    assert message.customer_id is not None
    assert message.phone_line_id is not None
    assert message.posted is False


async def test_inbound_sms_unknown_did_persisted_without_customer(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    sid = f"SMin{uuid.uuid4().hex[:10]}"
    resp = await client.post(_WEBHOOK, json=_inbound_event(sid, to_number="+19995550000"))
    assert resp.status_code == 204

    message = await _get_message(db_session, sid)
    assert message is not None
    assert message.customer_id is None
    assert message.phone_line_id is None


async def test_inbound_sms_duplicate_message_sid_is_idempotent(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    sid = f"SMin{uuid.uuid4().hex[:10]}"
    await client.post(_WEBHOOK, json=_inbound_event(sid))
    resp = await client.post(_WEBHOOK, json=_inbound_event(sid))
    assert resp.status_code == 204

    result = await db_session.execute(select(SmsMessage).where(SmsMessage.message_sid == sid))
    assert len(result.scalars().all()) == 1


async def test_inbound_sms_missing_numbers_is_noop(client, db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    event = _inbound_event("SMin_missing")
    event["data"]["payload"]["to"] = []
    resp = await client.post(_WEBHOOK, json=event)
    assert resp.status_code == 204
    assert await _get_message(db_session, "SMin_missing") is None


# ── message.received: VanillaSoft forward ──────────────────────────────────


async def test_inbound_sms_forwarded_to_vanillasoft_and_marked_posted(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", "cloudli-secret")
    phone = "+18205550100"
    await _create_customer_with_line(client, 8602, phone)

    sid = f"SMin{uuid.uuid4().hex[:10]}"
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(
            _WEBHOOK,
            json=_inbound_event(
                sid, to_number=phone, media=[{"url": "https://mms.example.com/a.jpg"}]
            ),
        )
    assert resp.status_code == 204

    http.post.assert_awaited_once()
    call = http.post.call_args
    assert call.args[0] == "http://vs.example.com/cloudliapi/notify/IncomingSmsMessage"
    assert call.kwargs["headers"] == {"X-Cloudli-Auth": "cloudli-secret"}
    payload = call.kwargs["json"]
    assert payload["referenceId"] == sid
    assert payload["isOutbound"] is False
    assert payload["to"] == [phone]
    assert payload["customerId"] == "8602"
    assert payload["mediaUrls"] == ["https://mms.example.com/a.jpg"]

    message = await _get_message(db_session, sid)
    assert message is not None
    assert message.posted is True


async def test_inbound_sms_forward_failure_leaves_unposted(client, db_session, monkeypatch) -> None:
    """A VanillaSoft outage must not block the ack; the row stays unposted for retry."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    phone = "+18305550100"
    await _create_customer_with_line(client, 8603, phone)

    sid = f"SMin{uuid.uuid4().hex[:10]}"
    http = _mock_http()
    http.post = AsyncMock(side_effect=ConnectionError("vs down"))
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(_WEBHOOK, json=_inbound_event(sid, to_number=phone))
    assert resp.status_code == 204

    message = await _get_message(db_session, sid)
    assert message is not None
    assert message.posted is False


# ── message.finalized: delivery receipt forward (A4) ───────────────────────


async def test_delivery_receipt_forwarded_to_vanillasoft(client, db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", "cloudli-secret")
    phone = "+18405550100"
    await _create_customer_with_line(client, 8604, phone)

    from app.main import app

    sid = f"SMout{uuid.uuid4().hex[:10]}"
    app.state.carrier.send_sms = AsyncMock(return_value={"sid": sid, "status": "queued"})
    resp = await client.post(
        f"{_SMS_BASE}/Send/8604",
        json={"from_number": phone, "to_number": "+12125550009", "body": "outbound hi"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200

    receipt = {
        "data": {
            "event_type": "message.finalized",
            "payload": {
                "id": sid,
                "from": {"phone_number": phone},
                "to": [{"phone_number": "+12125550009", "status": "delivered"}],
            },
        }
    }
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(_WEBHOOK, json=receipt)
    assert resp.status_code == 204

    http.post.assert_awaited_once()
    call = http.post.call_args
    assert call.args[0] == (
        "http://vs.example.com/cloudliapi/notify/IncomingSmsMessageDeliveryReceipt"
    )
    payload = call.kwargs["json"]
    assert payload["referenceId"] == sid
    assert payload["status"] == "delivered"
    assert payload["customerId"] == "8604"
    assert payload["isOutbound"] is True


async def test_delivery_receipt_unknown_sid_does_not_forward(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    receipt = {
        "data": {
            "event_type": "message.finalized",
            "payload": {
                "id": "SMunknown001",
                "to": [{"phone_number": "+12125550009", "status": "delivered"}],
            },
        }
    }
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(_WEBHOOK, json=receipt)
    assert resp.status_code == 204
    http.post.assert_not_awaited()


# ── retry job (sms_sync) ───────────────────────────────────────────────────

_CTX: dict = {}


def _make_unposted_message() -> MagicMock:
    message = MagicMock()
    message.id = uuid.uuid4()
    message.message_sid = "SMretry001"
    message.direction = "inbound"
    message.from_number = "+12125550001"
    message.to_number = "+18105550100"
    message.body = "retry me"
    message.delivery_status = "received"
    message.customer_id = None
    message.created_at = datetime(2026, 7, 4, 11, 0, 0)
    return message


def _mock_session() -> AsyncMock:
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


async def test_sms_retry_skips_when_no_webhook_url(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    with patch("app.services.sms_sync.async_session_factory") as factory:
        await retry_unposted_sms_messages(_CTX)
        factory.assert_not_called()


async def test_sms_retry_forwards_and_marks_posted(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    message = _make_unposted_message()

    mock_repo = AsyncMock()
    mock_repo.get_unposted_inbound.return_value = [message]
    http = _mock_http()

    with (
        patch("app.services.sms_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.sms_sync.SmsMessageRepo", return_value=mock_repo),
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http),
    ):
        await retry_unposted_sms_messages(_CTX)

    http.post.assert_awaited_once()
    assert http.post.call_args.args[0].endswith("/notify/IncomingSmsMessage")
    mock_repo.mark_posted.assert_awaited_once_with(message.id)


async def test_sms_retry_failure_does_not_mark_posted(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    message = _make_unposted_message()

    mock_repo = AsyncMock()
    mock_repo.get_unposted_inbound.return_value = [message]
    http = _mock_http(is_success=False, status_code=502)

    with (
        patch("app.services.sms_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.sms_sync.SmsMessageRepo", return_value=mock_repo),
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http),
    ):
        await retry_unposted_sms_messages(_CTX)

    mock_repo.mark_posted.assert_not_awaited()


async def test_sms_repo_get_unposted_inbound_filters(db_session) -> None:
    """Repo returns only inbound, unposted rows older than the retry age."""
    from datetime import UTC, timedelta

    from app.repositories.sms_message_repo import SmsMessageRepo

    repo = SmsMessageRepo(db_session)
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=5)

    stale_inbound = await repo.create(
        customer_id=None,
        phone_line_id=None,
        message_sid=f"SMrepo{uuid.uuid4().hex[:8]}",
        direction="inbound",
        from_number="+12125550001",
        to_number="+18105550100",
        body="old inbound",
        delivery_status="received",
    )
    outbound = await repo.create(
        customer_id=None,
        phone_line_id=None,
        message_sid=f"SMrepo{uuid.uuid4().hex[:8]}",
        direction="outbound",
        from_number="+18105550100",
        to_number="+12125550001",
        body="outbound",
        delivery_status="queued",
    )
    # Backdate both so the 1-minute retry window is not the discriminator.
    from sqlalchemy import update

    await db_session.execute(
        update(SmsMessage)
        .where(SmsMessage.id.in_([stale_inbound.id, outbound.id]))
        .values(created_at=old)
    )
    await db_session.commit()

    unposted = await repo.get_unposted_inbound()
    ids = {m.id for m in unposted}
    assert stale_inbound.id in ids
    assert outbound.id not in ids

    await repo.mark_posted(stale_inbound.id)
    unposted = await repo.get_unposted_inbound()
    assert stale_inbound.id not in {m.id for m in unposted}
