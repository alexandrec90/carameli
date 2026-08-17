from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.main import app
from app.services import (
    audio_asset_service,
    call_event_service,
    extension_service,
    voicemail_drop_event_service,
)
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_DROP_URL = "/vsapi/1.0.0/VsMessageDrop"
_VOICEMAIL_HOOK = "/webhooks/jambonz/voicemail-hook"

_VALID_PAYLOAD = {
    "vs_customer_id": 8200,
    "extension": "+14155550100",
    "msg_drop_number": "+12125550199",
    "audio_url": "https://cdn.example.com/drop.mp3",
}


async def _create_customer(client, vs_id: int) -> dict:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


async def test_voicemail_drop_happy_path(client) -> None:
    """Customer exists and engine succeeds — should return 200 with call_sid + status."""
    await _create_customer(client, 8200)

    from app.main import app

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        return_value={"call_id": "CAvm8200", "status": "queued"}
    )

    resp = await client.post(_DROP_URL, json=_VALID_PAYLOAD, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CAvm8200"
    assert body["status"] == "queued"


async def test_voicemail_drop_customer_not_found_returns_404(client) -> None:
    """Unknown vs_customer_id should return 404."""
    resp = await client.post(
        _DROP_URL,
        json={**_VALID_PAYLOAD, "vs_customer_id": 99980},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_voicemail_drop_engine_error_returns_502(client) -> None:
    """When the engine raises, should return 502."""
    await _create_customer(client, 8201)

    from app.main import app

    app.state.engine.initiate_voicemail_drop = AsyncMock(
        side_effect=Exception("Jambonz unreachable")
    )

    resp = await client.post(
        _DROP_URL,
        json={**_VALID_PAYLOAD, "vs_customer_id": 8201},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502
    assert "Provider error" in resp.json()["detail"]


async def test_voicemail_drop_no_auth_returns_401(client) -> None:
    """Missing Authorization header should return 401."""
    resp = await client.post(_DROP_URL, json=_VALID_PAYLOAD)
    assert resp.status_code == 401


async def test_voicemail_drop_cross_customer_returns_403(client) -> None:
    """A customer-scoped token may not drop calls for a different customer."""
    await _create_customer(client, 8202)
    await _create_customer(client, 8203)

    resp = await client.post(
        _DROP_URL,
        # token belongs to 8202, but payload targets 8203
        json={**_VALID_PAYLOAD, "vs_customer_id": 8203},
        headers={"Authorization": "Bearer key-8202"},
    )
    assert resp.status_code == 403


async def test_legacy_voicemail_code_plays_on_tenant_tracked_active_call(
    client, db_session
) -> None:
    customer = await _create_customer(client, 8204)
    customer_id = uuid.UUID(customer["id"])
    await extension_service.create(
        db_session,
        customer_id,
        "204",
        "ext204_8204",
        "client-8204",
        "sip.test",
    )
    asset = await audio_asset_service.create(
        db_session,
        customer_id=customer_id,
        kind="voicemail-drop",
        name="Intro",
        s3_key=f"audio/{customer_id}/intro.mp3",
        voicemail_drop_code=1,
    )
    await call_event_service.create_from_webhook(
        db_session,
        customer_id,
        {
            "CallSid": "call-active-8204",
            "CallStatus": "in-progress",
            "Direction": "outbound",
            "Extension": "204",
        },
    )
    app.state.engine.get_active_calls = AsyncMock(
        return_value=[{"call_sid": "call-active-8204", "call_status": "in-progress"}]
    )
    app.state.engine.play_audio_to_call = AsyncMock(
        return_value={"call_id": "call-active-8204", "status": "playing"}
    )

    with patch(
        "app.services.s3_service.get_presigned_download_url",
        return_value="https://s3.example.test/signed-intro",
    ):
        response = await client.post(
            f"{_DROP_URL}?vscustomerId=8204&extension=204&msgDropNumber=1",
            headers=AUTH_HEADERS,
        )
    assert response.status_code == 200, response.text
    assert response.json() == {"call_sid": "call-active-8204", "status": "playing"}
    app.state.engine.play_audio_to_call.assert_awaited_once_with(
        "call-active-8204", "https://s3.example.test/signed-intro"
    )
    events = await voicemail_drop_event_service.list_for_customer(db_session, customer_id)
    assert events[0].audio_asset_id == asset.id


async def test_legacy_voicemail_code_requires_configured_asset(client, db_session) -> None:
    customer = await _create_customer(client, 8205)
    customer_id = uuid.UUID(customer["id"])
    await extension_service.create(
        db_session,
        customer_id,
        "205",
        "ext205_8205",
        "client-8205",
        "sip.test",
    )
    response = await client.post(
        f"{_DROP_URL}?vscustomerId=8205&extension=205&msgDropNumber=9",
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Voicemail drop code not found"


# ---------------------------------------------------------------------------
# POST /webhooks/jambonz/voicemail-hook
# ---------------------------------------------------------------------------


async def test_voicemail_hook_plays_tagged_audio(client) -> None:
    """On answer, the hook plays the audio URL carried in the call tag, then hangs up."""
    resp = await client.post(
        _VOICEMAIL_HOOK,
        json={
            "call_sid": "CS-vm-answered",
            "tag": {"audio_url": "https://cdn.example.com/drop.mp3"},
        },
    )
    assert resp.status_code == 200
    assert resp.json() == [
        {"verb": "play", "url": "https://cdn.example.com/drop.mp3"},
        {"verb": "hangup"},
    ]


async def test_voicemail_hook_missing_audio_url_hangs_up(client) -> None:
    """No audio URL in the tag: end the call rather than leaving it open and billing."""
    resp = await client.post(_VOICEMAIL_HOOK, json={"call_sid": "CS-vm-no-tag"})
    assert resp.status_code == 200
    assert resp.json() == [{"verb": "hangup"}]


async def test_voicemail_hook_invalid_json_returns_400(client) -> None:
    resp = await client.post(
        _VOICEMAIL_HOOK,
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


async def test_voicemail_hook_bad_signature_returns_403(client, monkeypatch) -> None:
    """A wrong X-Jambonz-Signature is rejected before the body is processed."""
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "webhook-key")
    resp = await client.post(
        _VOICEMAIL_HOOK,
        content=b'{"call_sid":"CS-vm-badsig"}',
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": "bad"},
    )
    assert resp.status_code == 403
