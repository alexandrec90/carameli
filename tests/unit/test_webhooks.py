from __future__ import annotations

import pytest

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


async def test_call_status_missing_signature_header_returns_403(client) -> None:
    """Missing X-Jambonz-Signature when a secret is configured should return 403."""
    from app.core.config import settings

    original_secret = settings.jambonz_webhook_secret
    settings.jambonz_webhook_secret = "a-real-secret"

    body = b'{"call_sid": "CAmissingsig", "call_status": "completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json"},
        # No X-Jambonz-Signature header — defaults to empty string → HMAC mismatch
    )
    assert resp.status_code == 403

    settings.jambonz_webhook_secret = original_secret


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
