"""Tests for the call-status → VanillaSoft write-back (A3) and the
CallRecording availability notification (A6c)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.repositories.call_event_repo import CallEventRepo
from app.services import vanillasoft_notify
from tests.conftest import AUTH_HEADERS, notify_payload

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_WEBHOOK = "/webhooks/jambonz/call-status"


def _mock_http(is_success: bool = True, status_code: int = 200) -> AsyncMock:
    response = MagicMock()
    response.is_success = is_success
    response.status_code = status_code
    http = AsyncMock()
    http.__aenter__ = AsyncMock(return_value=http)
    http.__aexit__ = AsyncMock(return_value=False)
    http.post = AsyncMock(return_value=response)
    return http


async def _create_customer_with_line(client, vs_id: int, phone: str) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-wb-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201

    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNwb{vs_id}", "phone_number": phone}
    )
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "phone_number": phone},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()


async def test_terminal_call_posts_incoming_call_contract(client, db_session, monkeypatch) -> None:
    """Completed call → notify/IncomingCall with IncomingCall.cs shape + Carameli HMAC."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", "cloudli-secret")
    monkeypatch.setattr(settings, "carameli_notify_secret", "carameli-secret")
    phone = "+18605550100"
    await _create_customer_with_line(client, 8801, phone)

    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(
            _WEBHOOK,
            json={
                "call_sid": "CAwb001",
                "call_status": "completed",
                "direction": "inbound",
                "from": "+12125550001",
                "to": phone,
                "duration": "44",
            },
        )
    assert resp.status_code == 200

    http.post.assert_awaited_once()
    call = http.post.call_args
    assert call.args[0] == "http://vs.example.com/cloudliapi/notify/IncomingCall"
    assert call.kwargs["headers"]["Content-Type"] == "application/json"
    assert "X-Cloudli-Auth" not in call.kwargs["headers"]
    assert vanillasoft_notify.SIGNATURE_HEADER in call.kwargs["headers"]
    payload = notify_payload(call)
    assert payload["callId"] == "CAwb001"
    assert payload["eventName"] == "callHungup"
    assert payload["isInbound"] is True
    assert payload["customerId"] == 8801
    assert payload["fromNumber"] == "+12125550001"
    assert payload["toNumber"] == phone

    event = await CallEventRepo(db_session).get_by_call_sid("CAwb001")
    assert event is not None
    assert event.posted is True


async def test_terminal_call_with_recording_also_posts_call_recording(client, monkeypatch) -> None:
    """When a recording URL lands, notify/CallRecording fires with the Carameli URL."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    phone = "+18615550100"
    await _create_customer_with_line(client, 8802, phone)

    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(
            _WEBHOOK,
            json={
                "call_sid": "CAwb002",
                "call_status": "completed",
                "direction": "inbound",
                "from": "+12125550001",
                "to": phone,
                "duration": "50",
                "recording_url": "s3://carameli-recordings/2026/CAwb002.mp3",
            },
        )
    assert resp.status_code == 200

    assert http.post.await_count == 2
    urls = [c.args[0] for c in http.post.call_args_list]
    assert urls[0].endswith("/notify/IncomingCall")
    assert urls[1].endswith("/notify/CallRecording")

    recording_payload = notify_payload(http.post.call_args_list[1])
    assert recording_payload["callId"] == "CAwb002"
    assert recording_payload["CustomerID"] == 8802
    assert recording_payload["length"] == 50
    assert recording_payload["source"] != "asterisk"
    # recordingFile is the Carameli-served URL, not the raw s3:// reference.
    assert "/recordings/CAwb002?token=" in recording_payload["recordingFile"]


async def test_non_terminal_call_does_not_post(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    http = _mock_http()
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(
            _WEBHOOK,
            json={"call_sid": "CAwb003", "call_status": "ringing", "from": "+1", "to": "+2"},
        )
    assert resp.status_code == 200
    http.post.assert_not_awaited()


async def test_vanillasoft_failure_leaves_event_unposted(client, db_session, monkeypatch) -> None:
    """A VanillaSoft outage must not break webhook acknowledgement; retry job picks it up."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    http = _mock_http()
    http.post = AsyncMock(side_effect=ConnectionError("vs down"))
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=http):
        resp = await client.post(
            _WEBHOOK,
            json={"call_sid": "CAwb004", "call_status": "completed", "from": "+1", "to": "+2"},
        )
    assert resp.status_code == 200

    event = await CallEventRepo(db_session).get_by_call_sid("CAwb004")
    assert event is not None
    assert event.posted is False


async def test_no_webhook_url_skips_write_back(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    with patch("app.services.vanillasoft_notify.httpx.AsyncClient") as http_cls:
        resp = await client.post(
            _WEBHOOK,
            json={"call_sid": "CAwb005", "call_status": "completed", "from": "+1", "to": "+2"},
        )
    assert resp.status_code == 200
    http_cls.assert_not_called()
