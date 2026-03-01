from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS


@pytest.mark.asyncio
async def test_get_recording_not_found(client) -> None:
    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CAmissing001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Call not found"


@pytest.mark.asyncio
async def test_get_recording_no_recording(client) -> None:
    await client.post(
        "/webhooks/twilio/call-status",
        data={
            "CallSid": "CAnorecording001",
            "CallStatus": "completed",
            "From": "+14155550000",
            "To": "+14155550001",
            "CallDuration": "12",
        },
    )

    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CAnorecording001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No recording for this call"


@pytest.mark.asyncio
async def test_get_recording_success(client) -> None:
    await client.post(
        "/webhooks/twilio/call-status",
        data={
            "CallSid": "CArecording001",
            "CallStatus": "completed",
            "From": "+14155550000",
            "To": "+14155550001",
            "CallDuration": "120",
            "RecordingUrl": "https://api.twilio.com/recordings/RErecording001",
        },
    )

    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CArecording001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CArecording001"
    assert body["recording_url"] == "https://api.twilio.com/recordings/RErecording001"
    assert body["duration_seconds"] == 120
