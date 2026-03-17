from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_get_recording_not_found(client) -> None:
    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CAmissing001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Call not found"


async def test_get_recording_no_recording(client) -> None:
    await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CAnorecording001",
            "call_status": "completed",
            "from": "+14155550000",
            "to": "+14155550001",
            "duration": "12",
        },
    )

    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CAnorecording001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No recording for this call"


async def test_get_recording_success(client) -> None:
    await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CArecording001",
            "call_status": "completed",
            "from": "+14155550000",
            "to": "+14155550001",
            "duration": "120",
            "recording_url": "https://recordings.example.com/RErecording001",
        },
    )

    resp = await client.get(
        "/vsapi/1.0.0/VsCall/Recording/CArecording001",
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CArecording001"
    assert body["recording_url"] == "https://recordings.example.com/RErecording001"
    assert body["duration_seconds"] == 120
