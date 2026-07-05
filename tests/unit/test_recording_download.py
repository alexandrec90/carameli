"""Tests for the public token-authenticated recording download endpoint (A6)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.services import recording_links

pytestmark = pytest.mark.asyncio(loop_scope="session")

_WEBHOOK_JAMBONZ = "/webhooks/jambonz/call-status"


async def _store_recording(client, call_sid: str, recording_url: str) -> None:
    resp = await client.post(
        _WEBHOOK_JAMBONZ,
        json={
            "call_sid": call_sid,
            "call_status": "completed",
            "from": "+12125550001",
            "to": "+13135550002",
            "duration": "30",
            "recording_url": recording_url,
        },
    )
    assert resp.status_code == 200


def _download_path(call_sid: str) -> str:
    return f"/recordings/{call_sid}?token={recording_links.recording_token(call_sid)}"


async def test_download_provider_url_redirects(client) -> None:
    """A plain http(s) recording_url is passed through as a 307 redirect."""
    call_sid = "CAdl001"
    url = "https://recordings.example.com/CAdl001.mp3"
    await _store_recording(client, call_sid, url)

    resp = await client.get(_download_path(call_sid))
    assert resp.status_code == 307
    assert resp.headers["location"] == url


async def test_download_s3_url_redirects_to_presigned(client, monkeypatch) -> None:
    """An s3://bucket/key recording_url is presigned via the S3 service."""
    call_sid = "CAdl002"
    await _store_recording(client, call_sid, "s3://carameli-recordings/2026/CAdl002.mp3")

    with patch(
        "app.services.recording_links.s3_service.get_presigned_download_url",
        return_value="https://minio.example.com/presigned/CAdl002.mp3?sig=x",
    ) as presign:
        resp = await client.get(_download_path(call_sid))

    assert resp.status_code == 307
    assert resp.headers["location"] == "https://minio.example.com/presigned/CAdl002.mp3?sig=x"
    presign.assert_called_once_with("2026/CAdl002.mp3")


async def test_download_s3_unconfigured_returns_404(client) -> None:
    """If S3 presigning is unavailable the endpoint 404s instead of 500ing."""
    call_sid = "CAdl003"
    await _store_recording(client, call_sid, "s3://carameli-recordings/2026/CAdl003.mp3")

    with patch(
        "app.services.recording_links.s3_service.get_presigned_download_url",
        return_value=None,
    ):
        resp = await client.get(_download_path(call_sid))
    assert resp.status_code == 404


async def test_download_bad_token_returns_403(client) -> None:
    call_sid = "CAdl004"
    await _store_recording(client, call_sid, "https://recordings.example.com/CAdl004.mp3")

    resp = await client.get(f"/recordings/{call_sid}?token=not-the-right-token")
    assert resp.status_code == 403


async def test_download_non_ascii_token_returns_403(client) -> None:
    call_sid = "CAdl006"
    await _store_recording(client, call_sid, "https://recordings.example.com/CAdl006.mp3")

    resp = await client.get(f"/recordings/{call_sid}?token=%C2%80")
    assert resp.status_code == 403


async def test_download_missing_token_rejected(client) -> None:
    resp = await client.get("/recordings/CAdl004")
    assert resp.status_code == 422


async def test_download_unknown_call_returns_404(client) -> None:
    resp = await client.get(_download_path("CAdl_missing"))
    assert resp.status_code == 404


async def test_download_call_without_recording_returns_404(client) -> None:
    call_sid = "CAdl005"
    resp = await client.post(
        _WEBHOOK_JAMBONZ,
        json={"call_sid": call_sid, "call_status": "completed", "from": "+1", "to": "+2"},
    )
    assert resp.status_code == 200

    resp = await client.get(_download_path(call_sid))
    assert resp.status_code == 404


async def test_recording_token_is_deterministic_and_verifiable() -> None:
    token = recording_links.recording_token("CAtoken001")
    assert recording_links.verify_recording_token("CAtoken001", token)
    assert not recording_links.verify_recording_token("CAtoken002", token)
    assert not recording_links.verify_recording_token("CAtoken001", "\u0080")


async def test_public_recording_url_shape() -> None:
    from app.core.config import settings

    url = recording_links.public_recording_url("CAtoken001")
    assert url.startswith(settings.jambonz_webhook_base_url)
    assert "/recordings/CAtoken001?token=" in url
