from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, MagicMock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import pytest

from app.services.providers.engine.jambonz import JambonzEngine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_engine() -> JambonzEngine:
    return JambonzEngine(
        base_url="http://jambonz:3000",
        api_key="test-api-key",
        account_sid="ACC123",
        webhook_base_url="http://localhost:8000",
    )


def _mock_response(status_code: int, json_data: dict) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_error = status_code >= 400
    resp.json.return_value = json_data
    resp.text = str(json_data)
    resp.raise_for_status = MagicMock()
    return resp


def _jambonz_sig(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# initiate_call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiate_call_returns_call_id_and_status() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(200, {"sid": "JC001"})
    engine._client.post = AsyncMock(return_value=fake_resp)

    result = await engine.initiate_call("+14155550000", "+12125550100", "http://hook/voice")

    assert result == {"call_id": "JC001", "status": "queued"}
    engine._client.post.assert_awaited_once()
    call_kwargs = engine._client.post.call_args
    assert call_kwargs[0][0] == "/Accounts/ACC123/Calls"
    posted_json = call_kwargs[1]["json"]
    assert posted_json["from"] == "+14155550000"
    assert posted_json["to"] == {"type": "phone", "number": "+12125550100"}
    assert "call_status_hook" in posted_json


@pytest.mark.asyncio
async def test_initiate_call_raises_on_error() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(500, {"error": "internal error"})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 500"))
    engine._client.post = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 500"):
        await engine.initiate_call("+14155550000", "+12125550100", "http://hook/voice")


# ---------------------------------------------------------------------------
# hangup_call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hangup_call_sends_delete() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(200, {})
    engine._client.delete = AsyncMock(return_value=fake_resp)

    await engine.hangup_call("JC001")

    engine._client.delete.assert_awaited_once_with("/Accounts/ACC123/Calls/JC001")


@pytest.mark.asyncio
async def test_hangup_call_raises_on_error() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(404, {"error": "not found"})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 404"))
    engine._client.delete = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 404"):
        await engine.hangup_call("JC_missing")


# ---------------------------------------------------------------------------
# start_recording
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_recording_sends_put_with_action() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(200, {})
    engine._client.put = AsyncMock(return_value=fake_resp)

    result = await engine.start_recording("JC001")

    assert result == {"call_id": "JC001", "recording": "started"}
    call_kwargs = engine._client.put.call_args
    assert call_kwargs[1]["json"]["record"]["action"] == "startCallRecording"


@pytest.mark.asyncio
async def test_start_recording_raises_on_error() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(400, {"error": "bad request"})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 400"))
    engine._client.put = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 400"):
        await engine.start_recording("JC001")


# ---------------------------------------------------------------------------
# stop_recording
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_recording_sends_put_with_stop_action() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(200, {})
    engine._client.put = AsyncMock(return_value=fake_resp)

    await engine.stop_recording("JC001")

    call_kwargs = engine._client.put.call_args
    assert call_kwargs[1]["json"]["record"]["action"] == "stopCallRecording"


# ---------------------------------------------------------------------------
# get_call_status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_call_status_returns_status_dict() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(200, {"call_status": "completed", "duration": 42})
    engine._client.get = AsyncMock(return_value=fake_resp)

    result = await engine.get_call_status("JC001")

    assert result["call_id"] == "JC001"
    assert result["status"] == "completed"
    assert result["duration"] == 42
    engine._client.get.assert_awaited_once_with("/Accounts/ACC123/Calls/JC001")


@pytest.mark.asyncio
async def test_get_call_status_raises_on_error() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(404, {"error": "not found"})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 404"))
    engine._client.get = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 404"):
        await engine.get_call_status("JC_missing")


# ---------------------------------------------------------------------------
# initiate_voicemail_drop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiate_voicemail_drop_passes_audio_url_in_tag() -> None:
    engine = _make_engine()
    fake_resp = _mock_response(200, {"sid": "JC_vm001"})
    engine._client.post = AsyncMock(return_value=fake_resp)

    result = await engine.initiate_voicemail_drop(
        to="+12125550100", from_="+14155550000", audio_url="https://s3.example.com/vm.mp3"
    )

    assert result == {"call_id": "JC_vm001", "status": "queued"}
    posted_json = engine._client.post.call_args[1]["json"]
    assert posted_json["tag"]["audio_url"] == "https://s3.example.com/vm.mp3"


# ---------------------------------------------------------------------------
# Jambonz call-status webhook
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jambonz_call_status_webhook_writes_event(client, db_session) -> None:
    """POST /webhooks/jambonz/call-status should persist the event to call_events."""
    from app.core.config import settings
    from app.repositories.call_event_repo import CallEventRepo

    payload = {
        "call_sid": "JCtestwebhook001",
        "call_status": "completed",
        "direction": "outbound",
        "from": "+14155550000",
        "to": "+14155550001",
        "duration": 45,
    }
    body = json.dumps(payload).encode()

    original_secret = settings.jambonz_webhook_secret
    settings.jambonz_webhook_secret = ""  # Disable sig validation for this test

    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200

    settings.jambonz_webhook_secret = original_secret

    repo = CallEventRepo(db_session)
    event = await repo.get_by_call_sid("JCtestwebhook001")
    assert event is not None
    assert event.duration_seconds == 45
    assert event.status == "completed"


@pytest.mark.asyncio
async def test_jambonz_call_status_missing_sid_is_noop(client) -> None:
    from app.core.config import settings

    original_secret = settings.jambonz_webhook_secret
    settings.jambonz_webhook_secret = ""

    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=json.dumps({"call_status": "completed"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200

    settings.jambonz_webhook_secret = original_secret


@pytest.mark.asyncio
async def test_jambonz_call_status_invalid_signature_returns_403(client) -> None:
    from app.core.config import settings

    original_secret = settings.jambonz_webhook_secret
    settings.jambonz_webhook_secret = "real-secret"

    body = json.dumps({"call_sid": "JC999", "call_status": "completed"}).encode()
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Jambonz-Signature": "badsignature",
        },
    )
    assert resp.status_code == 403

    settings.jambonz_webhook_secret = original_secret


# ---------------------------------------------------------------------------
# Telnyx sms-inbound webhook
# ---------------------------------------------------------------------------


def _make_ed25519_keypair() -> tuple[Ed25519PrivateKey, str]:
    """Return (private_key, base64_public_key) for use in tests."""
    private_key = Ed25519PrivateKey.generate()
    pub_bytes = private_key.public_key().public_bytes_raw()
    return private_key, base64.b64encode(pub_bytes).decode()


def _telnyx_sig_headers(private_key: Ed25519PrivateKey, body: bytes, ts: int) -> dict[str, str]:
    signed_payload = f"{ts}|".encode() + body
    sig = base64.b64encode(private_key.sign(signed_payload)).decode()
    return {
        "Content-Type": "application/json",
        "telnyx-signature-ed25519": sig,
        "telnyx-timestamp": str(ts),
    }


_SMS_PAYLOAD = {
    "data": {
        "event_type": "message.received",
        "payload": {
            "from": {"phone_number": "+14155550000"},
            "to": [{"phone_number": "+12125550100"}],
            "text": "Hello from Telnyx",
        },
    }
}


@pytest.mark.asyncio
async def test_telnyx_sms_inbound_dev_mode_returns_204(client) -> None:
    """With no secret configured, validation is skipped and valid payloads return 204."""
    from app.core.config import settings

    original = settings.telnyx_webhook_secret
    settings.telnyx_webhook_secret = ""

    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=json.dumps(_SMS_PAYLOAD).encode(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 204

    settings.telnyx_webhook_secret = original


@pytest.mark.asyncio
async def test_telnyx_sms_inbound_valid_ed25519_signature_returns_204(client) -> None:
    """Valid Ed25519 signature and timestamp → 204."""
    from app.core.config import settings

    private_key, pub_key_b64 = _make_ed25519_keypair()
    original = settings.telnyx_webhook_secret
    settings.telnyx_webhook_secret = pub_key_b64

    body = json.dumps(_SMS_PAYLOAD).encode()
    ts = int(time.time())
    headers = _telnyx_sig_headers(private_key, body, ts)

    resp = await client.post("/webhooks/telnyx/sms-inbound", content=body, headers=headers)
    assert resp.status_code == 204

    settings.telnyx_webhook_secret = original


@pytest.mark.asyncio
async def test_telnyx_sms_inbound_tampered_payload_returns_403(client) -> None:
    """Signature is valid for the original body; sending a different body must return 403."""
    from app.core.config import settings

    private_key, pub_key_b64 = _make_ed25519_keypair()
    original = settings.telnyx_webhook_secret
    settings.telnyx_webhook_secret = pub_key_b64

    original_body = json.dumps(_SMS_PAYLOAD).encode()
    ts = int(time.time())
    headers = _telnyx_sig_headers(private_key, original_body, ts)

    tampered_body = json.dumps({"data": {"event_type": "evil.payload"}}).encode()
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound", content=tampered_body, headers=headers
    )
    assert resp.status_code == 403

    settings.telnyx_webhook_secret = original


@pytest.mark.asyncio
async def test_telnyx_sms_inbound_invalid_signature_returns_403(client) -> None:
    """Garbage signature with a real secret must return 403."""
    from app.core.config import settings

    _, pub_key_b64 = _make_ed25519_keypair()
    original = settings.telnyx_webhook_secret
    settings.telnyx_webhook_secret = pub_key_b64

    body = json.dumps(_SMS_PAYLOAD).encode()
    ts = int(time.time())
    junk_sig = base64.b64encode(b"not_a_real_signature_at_all_xxxx").decode()
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": junk_sig,
            "telnyx-timestamp": str(ts),
        },
    )
    assert resp.status_code == 403

    settings.telnyx_webhook_secret = original


@pytest.mark.asyncio
async def test_telnyx_sms_inbound_replay_attack_returns_403(client) -> None:
    """Valid signature but timestamp older than 300 s must return 403."""
    from app.core.config import settings

    private_key, pub_key_b64 = _make_ed25519_keypair()
    original = settings.telnyx_webhook_secret
    settings.telnyx_webhook_secret = pub_key_b64

    body = json.dumps(_SMS_PAYLOAD).encode()
    old_ts = int(time.time()) - 301
    headers = _telnyx_sig_headers(private_key, body, old_ts)

    resp = await client.post("/webhooks/telnyx/sms-inbound", content=body, headers=headers)
    assert resp.status_code == 403

    settings.telnyx_webhook_secret = original


@pytest.mark.asyncio
async def test_telnyx_sms_inbound_unknown_event_type_returns_204(client) -> None:
    """Unrecognised event_type should be silently accepted and return 204 (no-op)."""
    from app.core.config import settings

    original = settings.telnyx_webhook_secret
    settings.telnyx_webhook_secret = ""

    unknown_payload = {"data": {"event_type": "some.future.event", "payload": {}}}
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=json.dumps(unknown_payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 204

    settings.telnyx_webhook_secret = original
