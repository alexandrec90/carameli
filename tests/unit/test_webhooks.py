from __future__ import annotations

import base64
import hashlib
import hmac as _stdlib_hmac
import time

import pytest

from app.core.config import settings
from app.repositories.call_event_repo import CallEventRepo

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize("terminal_status", ["no-answer", "busy", "failed", "canceled"])
async def test_call_status_all_terminal_statuses_persist(
    client, db_session, terminal_status: str
) -> None:
    """Each Jambonz terminal call status should be stored to call_events."""
    call_sid = f"CAterminal_{terminal_status.replace('-', '_')}"
    payload = {
        "call_sid": call_sid,
        "call_status": terminal_status,
        "from": "+14155550010",
        "to": "+14155550011",
    }
    resp = await client.post("/webhooks/jambonz/call-status", json=payload)
    assert resp.status_code == 200

    event = await CallEventRepo(db_session).get_by_call_sid(call_sid)
    assert event is not None
    assert event.status == terminal_status


async def test_call_status_webhook_writes_event(client, db_session) -> None:
    """Jambonz call-status POST should persist the event to call_events."""
    payload = {
        "call_sid": "CAtestwebhook001",
        "call_status": "completed",
        "direction": "outbound",
        "from": "+14155550000",
        "to": "+14155550001",
        "duration": "45",
    }
    resp = await client.post("/webhooks/jambonz/call-status", json=payload)
    assert resp.status_code == 200

    repo = CallEventRepo(db_session)
    event = await repo.get_by_call_sid("CAtestwebhook001")
    assert event is not None
    assert event.duration_seconds == 45
    assert event.status == "completed"


async def test_call_status_missing_sid_is_noop(client) -> None:
    """A call-status webhook without a call_sid should return 200 without crashing."""
    resp = await client.post("/webhooks/jambonz/call-status", json={"call_status": "completed"})
    assert resp.status_code == 200


async def test_call_status_non_json_body_returns_400(client) -> None:
    """A non-JSON request body should return 400 without crashing."""
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=b"this is not json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


async def test_call_status_missing_signature_header_returns_403(client, monkeypatch) -> None:
    """Missing X-Jambonz-Signature when a secret is configured should return 403."""
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "a-real-key")

    body = b'{"call_sid": "CAmissingsig", "call_status": "completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json"},
        # No X-Jambonz-Signature header — defaults to empty string → HMAC mismatch
    )
    assert resp.status_code == 403


async def test_call_status_duplicate_sid_is_idempotent(client, db_session) -> None:
    """Posting the same call_sid twice should not create a duplicate event."""
    payload = {
        "call_sid": "CAtestdupe001",
        "call_status": "completed",
        "from": "+14155550000",
        "to": "+14155550001",
    }
    await client.post("/webhooks/jambonz/call-status", json=payload)
    await client.post("/webhooks/jambonz/call-status", json=payload)

    from sqlalchemy import select

    from app.models.call_event import CallEvent

    result = await db_session.execute(
        select(CallEvent).where(CallEvent.call_sid == "CAtestdupe001")
    )
    events = result.scalars().all()
    assert len(events) == 1


# ── Security / adversarial tests ──────────────────────────────────────────


def _jambonz_sig(secret: str, body: bytes) -> str:
    return _stdlib_hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey as _Ed25519PrivateKey,
    )

    def _make_telnyx_keypair():
        priv = _Ed25519PrivateKey.generate()
        pub_bytes = priv.public_key().public_bytes_raw()
        pub_b64 = base64.b64encode(pub_bytes).decode()
        return priv, pub_b64

    def _telnyx_sign(priv, body: bytes, ts: str) -> str:
        signed_payload = f"{ts}|".encode() + body
        return base64.b64encode(priv.sign(signed_payload)).decode()

    _HAS_CRYPTOGRAPHY = True
except ImportError:
    _HAS_CRYPTOGRAPHY = False


# ── Jambonz HMAC signature tests ──────────────────────────────────────────


async def test_jambonz_valid_signature_accepted(client, monkeypatch) -> None:
    shared_key = "test-key"
    body = b'{"call_sid":"CAsigok","call_status":"completed"}'
    sig = _jambonz_sig(shared_key, body)
    monkeypatch.setattr(settings, "jambonz_webhook_secret", shared_key)
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": sig},
    )
    assert resp.status_code == 200


async def test_jambonz_invalid_signature_returns_403(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "webhook-key")
    body = b'{"call_sid":"CAbadsig","call_status":"completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": "bad"},
    )
    assert resp.status_code == 403


async def test_jambonz_tampered_payload_returns_403(client, monkeypatch) -> None:
    shared_key = "tamper-key"
    original = b'{"call_sid":"CAtamper","call_status":"completed"}'
    sig = _jambonz_sig(shared_key, original)
    tampered = b'{"call_sid":"CAtamper","call_status":"failed"}'
    monkeypatch.setattr(settings, "jambonz_webhook_secret", shared_key)
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=tampered,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": sig},
    )
    assert resp.status_code == 403


async def test_jambonz_empty_signature_returns_403(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "nonempty")
    body = b'{"call_sid":"CAemptysig","call_status":"completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": ""},
    )
    assert resp.status_code == 403


async def test_jambonz_no_secret_configured_skips_validation(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "")
    body = b'{"call_sid":"CAnosecret","call_status":"completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200


# ── Telnyx Ed25519 signature tests ────────────────────────────────────────


@pytest.mark.skipif(not _HAS_CRYPTOGRAPHY, reason="cryptography package not installed")
async def test_telnyx_valid_signature_accepted(client, monkeypatch) -> None:
    priv, pub_b64 = _make_telnyx_keypair()
    body = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()))
    sig = _telnyx_sign(priv, body, ts)
    monkeypatch.setattr(settings, "telnyx_webhook_secret", pub_b64)
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": sig,
            "telnyx-timestamp": ts,
        },
    )
    assert resp.status_code == 204


@pytest.mark.skipif(not _HAS_CRYPTOGRAPHY, reason="cryptography package not installed")
async def test_telnyx_invalid_signature_returns_403(client, monkeypatch) -> None:
    _, pub_b64 = _make_telnyx_keypair()
    body = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()))
    monkeypatch.setattr(settings, "telnyx_webhook_secret", pub_b64)
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": base64.b64encode(b"badsig").decode(),
            "telnyx-timestamp": ts,
        },
    )
    assert resp.status_code == 403


@pytest.mark.skipif(not _HAS_CRYPTOGRAPHY, reason="cryptography package not installed")
async def test_telnyx_stale_timestamp_returns_403(client, monkeypatch) -> None:
    priv, pub_b64 = _make_telnyx_keypair()
    body = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()) - 400)  # 400 s ago — beyond the 300 s window
    sig = _telnyx_sign(priv, body, ts)
    monkeypatch.setattr(settings, "telnyx_webhook_secret", pub_b64)
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": sig,
            "telnyx-timestamp": ts,
        },
    )
    assert resp.status_code == 403


@pytest.mark.skipif(not _HAS_CRYPTOGRAPHY, reason="cryptography package not installed")
async def test_telnyx_missing_timestamp_returns_403(client, monkeypatch) -> None:
    _, pub_b64 = _make_telnyx_keypair()
    monkeypatch.setattr(settings, "telnyx_webhook_secret", pub_b64)
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        json={"data": {"event_type": "message.received", "payload": {}}},
        headers={"telnyx-signature-ed25519": "whatever"},
    )
    assert resp.status_code == 403


@pytest.mark.skipif(not _HAS_CRYPTOGRAPHY, reason="cryptography package not installed")
async def test_telnyx_tampered_payload_returns_403(client, monkeypatch) -> None:
    priv, pub_b64 = _make_telnyx_keypair()
    original = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()))
    sig = _telnyx_sign(priv, original, ts)
    tampered = b'{"data":{"event_type":"message.received","payload":{"injected":true}}}'
    monkeypatch.setattr(settings, "telnyx_webhook_secret", pub_b64)
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=tampered,
        headers={
            "Content-Type": "application/json",
            "telnyx-signature-ed25519": sig,
            "telnyx-timestamp": ts,
        },
    )
    assert resp.status_code == 403


async def test_telnyx_no_secret_configured_skips_validation(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "telnyx_webhook_secret", "")
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        json={"data": {"event_type": "message.received", "payload": {}}},
    )
    assert resp.status_code == 204


async def test_call_status_duplicate_sid_updates_existing_event(client, db_session) -> None:
    """Subsequent callbacks for same call_sid should update status/duration/recording fields."""
    await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CAtestupdate001",
            "call_status": "ringing",
            "from": "+14155550000",
            "to": "+14155550001",
        },
    )
    await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CAtestupdate001",
            "call_status": "completed",
            "from": "+14155550000",
            "to": "+14155550001",
            "duration": "31",
            "recording_url": "https://recordings.example.com/REtest001",
        },
    )

    repo = CallEventRepo(db_session)
    event = await repo.get_by_call_sid("CAtestupdate001")
    assert event is not None
    assert event.status == "completed"
    assert event.duration_seconds == 31
    assert event.recording_url == "https://recordings.example.com/REtest001"
