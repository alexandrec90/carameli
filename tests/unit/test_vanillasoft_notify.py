"""Schema tests pinning Carameli's webhook-out payloads to the VanillaSoft
CloudliApi model shapes (IncomingCall.cs, CallRecording.cs, SmsMessage.cs)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.services import vanillasoft_notify

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Field sets copied from ../VanillaLand/AppCode/VanillaSoft.CloudliApi/Models/.
_INCOMING_CALL_FIELDS = {
    "callId",
    "callIdUuid",
    "timestamp",
    "from",
    "fromName",
    "fromNumber",
    "to",
    "toNumber",
    "accountId",
    "eventName",
    "isInbound",
    "customerId",
}
_CALL_RECORDING_FIELDS = {
    "accountId",
    "endpoint",
    "recordDate",
    "endRecording",
    "callerName",
    "callerNumber",
    "recordingFile",
    "isInbound",
    "length",
    "source",
    "callId",
    "calleeNumber",
    "CustomerID",
    "callIdParent",
}
_SMS_MESSAGE_FIELDS = {
    "referenceId",
    "isOutbound",
    "smsProviderName",
    "accountID",
    "from",
    "to",
    "timestamp",
    "message",
    "mediaUrls",
    "status",
    "customerId",
}


def _make_event(**overrides) -> MagicMock:
    event = MagicMock()
    event.call_sid = "CAnotify001"
    event.status = "completed"
    event.direction = "inbound"
    event.from_number = "+12125550001"
    event.to_number = "+13135550002"
    event.extension = "104"
    event.duration_seconds = 33
    event.recording_url = "https://provider.example.com/rec.mp3"
    event.started_at = datetime(2026, 7, 4, 12, 0, 0)
    event.ended_at = datetime(2026, 7, 4, 12, 0, 33)
    for key, value in overrides.items():
        setattr(event, key, value)
    return event


def _make_message(**overrides) -> MagicMock:
    message = MagicMock()
    message.message_sid = "SMnotify001"
    message.direction = "inbound"
    message.from_number = "+12125550001"
    message.to_number = "+13135550002"
    message.body = "hello there"
    message.delivery_status = "received"
    message.created_at = datetime(2026, 7, 4, 12, 0, 0)
    for key, value in overrides.items():
        setattr(message, key, value)
    return message


# ── IncomingCall.cs ────────────────────────────────────────────────────────


async def test_incoming_call_payload_matches_model_shape() -> None:
    payload = vanillasoft_notify.incoming_call_payload(_make_event(), 4321)
    assert set(payload.keys()) == _INCOMING_CALL_FIELDS
    assert payload["callId"] == "CAnotify001"
    assert payload["callIdUuid"] == "CAnotify001"
    assert isinstance(payload["timestamp"], int)
    assert payload["fromNumber"] == "+12125550001"
    assert payload["toNumber"] == "+13135550002"
    assert payload["accountId"] == "4321"
    assert payload["isInbound"] is True
    assert payload["customerId"] == 4321


@pytest.mark.parametrize(
    ("status", "event_name"),
    [
        ("completed", "callHungup"),
        ("no-answer", "callHungup"),
        ("busy", "callHungup"),
        ("failed", "callHungup"),
        ("canceled", "callHungup"),
        ("answered", "callAnswered"),
        ("ringing", "callReceived"),
        ("in-progress", "callInProgress"),
        ("something-unknown", "callInProgress"),
    ],
)
async def test_incoming_call_event_name_mapping(status: str, event_name: str) -> None:
    payload = vanillasoft_notify.incoming_call_payload(_make_event(status=status), 1)
    assert payload["eventName"] == event_name


async def test_incoming_call_unknown_customer_defaults() -> None:
    payload = vanillasoft_notify.incoming_call_payload(_make_event(direction="outbound"), None)
    assert payload["customerId"] == 0
    assert payload["accountId"] == ""
    assert payload["isInbound"] is False


# ── CallRecording.cs ───────────────────────────────────────────────────────


async def test_call_recording_payload_matches_model_shape() -> None:
    payload = vanillasoft_notify.call_recording_payload(
        _make_event(), 4321, "https://carameli.example.com/recordings/CAnotify001?token=abc"
    )
    assert set(payload.keys()) == _CALL_RECORDING_FIELDS
    assert payload["recordingFile"].startswith("https://carameli.example.com/recordings/")
    assert payload["length"] == 33
    assert payload["callId"] == "CAnotify001"
    assert payload["calleeNumber"] == "+13135550002"
    assert payload["callerNumber"] == "+12125550001"
    assert payload["CustomerID"] == 4321
    # VanillaSoft drops recordings whose source is "asterisk".
    assert payload["source"] != "asterisk"


# ── SmsMessage.cs ──────────────────────────────────────────────────────────


async def test_sms_message_payload_matches_model_shape() -> None:
    payload = vanillasoft_notify.sms_message_payload(
        _make_message(), 4321, ["https://mms.example.com/1.jpg"]
    )
    assert set(payload.keys()) == _SMS_MESSAGE_FIELDS
    assert payload["referenceId"] == "SMnotify001"
    assert payload["isOutbound"] is False
    assert payload["to"] == ["+13135550002"]
    assert payload["mediaUrls"] == ["https://mms.example.com/1.jpg"]
    assert payload["message"] == "hello there"
    assert payload["status"] == "received"
    # customerId is a *string* in SmsMessage.cs (the receipt handler parses it).
    assert payload["customerId"] == "4321"
    assert payload["accountID"] == "4321"


async def test_sms_message_payload_outbound_flag() -> None:
    payload = vanillasoft_notify.sms_message_payload(_make_message(direction="outbound"), 7)
    assert payload["isOutbound"] is True
    assert payload["mediaUrls"] == []


# ── post_notification ──────────────────────────────────────────────────────


def _mock_http(is_success: bool = True, status_code: int = 200, text: str = "") -> AsyncMock:
    response = MagicMock()
    response.is_success = is_success
    response.status_code = status_code
    response.text = text
    http = AsyncMock()
    http.__aenter__ = AsyncMock(return_value=http)
    http.__aexit__ = AsyncMock(return_value=False)
    http.post = AsyncMock(return_value=response)
    return http


async def test_post_notification_unconfigured_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient") as mock_cls:
        assert (
            await vanillasoft_notify.post_notification(vanillasoft_notify.INCOMING_CALL_PATH, {})
            is False
        )
        mock_cls.assert_not_called()


async def test_post_notification_sends_cloudli_auth_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/api/")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", "shared-secret")
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        ok = await vanillasoft_notify.post_notification(
            vanillasoft_notify.INCOMING_CALL_PATH, {"a": 1}
        )
    assert ok is True
    call = http.post.call_args
    assert call.args[0] == "http://vs.example.com/api/notify/IncomingCall"
    assert call.kwargs["headers"] == {"X-Cloudli-Auth": "shared-secret"}
    assert call.kwargs["json"] == {"a": 1}


async def test_post_notification_timeout_covers_synchronous_receiver(monkeypatch) -> None:
    """The honest receiver processes on the request thread (SOAP hop included), so the
    client timeout must be 30 s — 10 s would abort still-running processing."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        await vanillasoft_notify.post_notification(vanillasoft_notify.INCOMING_CALL_PATH, {})
    assert http.post.call_args.kwargs["timeout"] == 30.0


async def test_notify_path_constants_are_bare_suffixes() -> None:
    """The receiver prefix lives in VANILLASOFT_NOTIFY_PREFIX; a 'notify/' in a constant
    would double the prefix in every URL."""
    for constant in (
        vanillasoft_notify.INCOMING_CALL_PATH,
        vanillasoft_notify.CALL_RECORDING_PATH,
        vanillasoft_notify.INCOMING_SMS_PATH,
        vanillasoft_notify.SMS_DELIVERY_RECEIPT_PATH,
    ):
        assert "/" not in constant


@pytest.mark.parametrize(
    ("prefix", "expected_url"),
    [
        ("notify", "http://vs.example.com/api/notify/IncomingSmsMessage"),
        ("carameli/notify", "http://vs.example.com/api/carameli/notify/IncomingSmsMessage"),
    ],
)
async def test_post_notification_url_honours_notify_prefix(
    monkeypatch, prefix: str, expected_url: str
) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/api")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    monkeypatch.setattr(settings, "vanillasoft_notify_prefix", prefix)
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        ok = await vanillasoft_notify.post_notification(vanillasoft_notify.INCOMING_SMS_PATH, {})
    assert ok is True
    assert http.post.call_args.args[0] == expected_url


async def test_post_notification_url_normalizes_stray_slashes(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/api/")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    monkeypatch.setattr(settings, "vanillasoft_notify_prefix", "/carameli/notify/")
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        await vanillasoft_notify.post_notification(vanillasoft_notify.CALL_RECORDING_PATH, {})
    assert (
        http.post.call_args.args[0] == "http://vs.example.com/api/carameli/notify/CallRecording"
    )


async def test_post_notification_non_2xx_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    http = _mock_http(is_success=False, status_code=500)
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        assert (
            await vanillasoft_notify.post_notification(vanillasoft_notify.INCOMING_CALL_PATH, {})
            is False
        )


async def test_post_notification_non_2xx_logs_body_and_ref(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    http = _mock_http(is_success=False, status_code=400, text="Invalid customerId")
    with (
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http),
        caplog.at_level(logging.WARNING, logger="app.services.vanillasoft_notify"),
    ):
        ok = await vanillasoft_notify.post_notification(
            vanillasoft_notify.INCOMING_CALL_PATH, {"callId": "CAfail001"}
        )
    assert ok is False
    record = caplog.records[-1]
    assert record.levelno == logging.WARNING
    assert "400" in record.getMessage()
    assert "ref=CAfail001" in record.getMessage()
    assert "body=Invalid customerId" in record.getMessage()


async def test_post_notification_5xx_logs_error_with_reference_id(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    http = _mock_http(is_success=False, status_code=500, text="SqlException: timeout")
    with (
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http),
        caplog.at_level(logging.WARNING, logger="app.services.vanillasoft_notify"),
    ):
        ok = await vanillasoft_notify.post_notification(
            vanillasoft_notify.INCOMING_SMS_PATH, {"referenceId": "SMfail001"}
        )
    assert ok is False
    record = caplog.records[-1]
    assert record.levelno == logging.ERROR
    assert "ref=SMfail001" in record.getMessage()
    assert "body=SqlException: timeout" in record.getMessage()


async def test_post_notification_non_2xx_truncates_long_body(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    http = _mock_http(is_success=False, status_code=400, text="x" * 5000)
    with (
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http),
        caplog.at_level(logging.WARNING, logger="app.services.vanillasoft_notify"),
    ):
        ok = await vanillasoft_notify.post_notification(vanillasoft_notify.INCOMING_CALL_PATH, {})
    assert ok is False
    message = caplog.records[-1].getMessage()
    assert "...[truncated]" in message
    assert "x" * 2000 in message
    assert "x" * 2001 not in message


async def test_truncate_short_body_unchanged() -> None:
    assert vanillasoft_notify._truncate("short body") == "short body"


async def test_truncate_exact_limit_unchanged() -> None:
    text = "y" * 2000
    assert vanillasoft_notify._truncate(text) == text


async def test_truncate_over_limit_capped_with_marker() -> None:
    result = vanillasoft_notify._truncate("z" * 2001)
    assert result == "z" * 2000 + "...[truncated]"


async def test_truncate_custom_limit() -> None:
    assert vanillasoft_notify._truncate("abcdef", limit=4) == "abcd...[truncated]"


async def test_post_notification_connection_error_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com")
    http = _mock_http()
    http.post = AsyncMock(side_effect=ConnectionError("down"))
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        assert (
            await vanillasoft_notify.post_notification(vanillasoft_notify.INCOMING_CALL_PATH, {})
            is False
        )


async def test_incoming_call_payload_roundtrip_with_orm_event(db_session) -> None:
    """Builder works against a real CallEvent row, not just mocks."""
    from app.repositories.call_event_repo import CallEventRepo

    event = await CallEventRepo(db_session).create_from_webhook(
        customer_id=None,
        payload={
            "CallSid": f"CAnotify{uuid.uuid4().hex[:8]}",
            "CallStatus": "completed",
            "Direction": "inbound",
            "From": "+12125550001",
            "To": "+13135550002",
            "CallDuration": "12",
        },
    )
    payload = vanillasoft_notify.incoming_call_payload(event, 99)
    assert set(payload.keys()) == _INCOMING_CALL_FIELDS
    assert payload["eventName"] == "callHungup"
    assert payload["isInbound"] is True
