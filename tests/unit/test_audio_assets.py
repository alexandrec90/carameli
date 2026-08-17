from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_AUDIO_BASE = "/vsapi/1.0.0/VsAudio"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _confirm_asset(client, vs_id: int, customer_id: uuid.UUID, **over) -> dict:
    body = {
        "vs_customer_id": vs_id,
        "name": "Test Track",
        "kind": "music",
        "s3_key": f"audio/{customer_id}/{uuid.uuid4()}",
        **over,
    }
    resp = await client.post(f"{_AUDIO_BASE}/ConfirmUpload", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_confirm_upload_success(client) -> None:
    customer_id = await _create_customer(client, 9001)
    body = await _confirm_asset(client, 9001, customer_id, name="My Music", kind="music")
    assert body["name"] == "My Music"
    assert body["kind"] == "music"
    assert body["active"] is True
    assert body["playback_url"] is None  # S3 not configured in tests


async def test_confirm_upload_assigns_unique_voicemail_drop_code(client) -> None:
    customer_id = await _create_customer(client, 9012)
    body = await _confirm_asset(
        client,
        9012,
        customer_id,
        name="Drop one",
        kind="voicemail-drop",
        voicemail_drop_code=1,
    )
    assert body["voicemail_drop_code"] == 1

    duplicate = await client.post(
        f"{_AUDIO_BASE}/ConfirmUpload",
        json={
            "vs_customer_id": 9012,
            "name": "Duplicate",
            "kind": "voicemail-drop",
            "s3_key": f"audio/{customer_id}/{uuid.uuid4()}",
            "voicemail_drop_code": 1,
        },
        headers=AUTH_HEADERS,
    )
    assert duplicate.status_code == 409


async def test_confirm_upload_rejects_another_customers_s3_key(client) -> None:
    customer_id = await _create_customer(client, 9013)
    response = await client.post(
        f"{_AUDIO_BASE}/ConfirmUpload",
        json={
            "vs_customer_id": 9013,
            "name": "Foreign object",
            "kind": "voicemail-drop",
            "s3_key": f"audio/{uuid.uuid4()}/private.mp3",
            "voicemail_drop_code": 2,
        },
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 422
    assert str(customer_id) not in response.text


async def test_confirm_upload_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_AUDIO_BASE}/ConfirmUpload",
        json={
            "vs_customer_id": 799901,
            "name": "Ghost",
            "kind": "music",
            "s3_key": "audio/ghost",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


async def test_confirm_upload_missing_name_returns_422(client) -> None:
    await _create_customer(client, 9002)
    resp = await client.post(
        f"{_AUDIO_BASE}/ConfirmUpload",
        json={"vs_customer_id": 9002, "kind": "music", "s3_key": "audio/x"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_list_audio_assets_filters_by_kind(client) -> None:
    customer_id = await _create_customer(client, 9003)
    await _confirm_asset(client, 9003, customer_id, kind="music", name="Track A")
    await _confirm_asset(client, 9003, customer_id, kind="hold", name="Hold B")

    resp = await client.get(f"{_AUDIO_BASE}/List/9003?kind=music", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 9003
    assert all(a["kind"] == "music" for a in body["assets"])
    assert any(a["name"] == "Track A" for a in body["assets"])


async def test_list_audio_assets_all_kinds(client) -> None:
    customer_id = await _create_customer(client, 9004)
    await _confirm_asset(client, 9004, customer_id, kind="music")
    await _confirm_asset(client, 9004, customer_id, kind="hold")

    resp = await client.get(f"{_AUDIO_BASE}/List/9004", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert len(resp.json()["assets"]) == 2


async def test_list_audio_assets_empty(client) -> None:
    await _create_customer(client, 9005)
    resp = await client.get(f"{_AUDIO_BASE}/List/9005", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["assets"] == []


async def test_list_audio_assets_isolated_per_customer(client) -> None:
    customer_id = await _create_customer(client, 9006)
    await _create_customer(client, 9007)
    await _confirm_asset(client, 9006, customer_id, name="Private Track")

    resp = await client.get(f"{_AUDIO_BASE}/List/9007", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["assets"] == []


async def test_list_audio_assets_customer_not_found(client) -> None:
    resp = await client.get(f"{_AUDIO_BASE}/List/799902", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_deactivate_audio_asset_success(client) -> None:
    customer_id = await _create_customer(client, 9008)
    created = await _confirm_asset(client, 9008, customer_id, name="To Remove")

    resp = await client.put(f"{_AUDIO_BASE}/Deactivate/9008/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_AUDIO_BASE}/List/9008", headers=AUTH_HEADERS)
    assert listed.json()["assets"] == []


async def test_deactivate_audio_asset_not_found(client) -> None:
    await _create_customer(client, 9009)
    resp = await client.put(f"{_AUDIO_BASE}/Deactivate/9009/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Audio asset not found"


async def test_presigned_upload_503_when_s3_not_configured(client) -> None:
    await _create_customer(client, 9010)
    resp = await client.post(
        f"{_AUDIO_BASE}/PresignedUpload",
        json={
            "vs_customer_id": 9010,
            "name": "Song",
            "kind": "music",
            "content_type": "audio/mpeg",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 503


async def test_presigned_upload_returns_url_when_s3_configured(client) -> None:
    await _create_customer(client, 9011)
    fake_url = "https://s3.example.com/bucket/audio/key?X-Amz-Signature=abc"
    with (
        patch("app.services.s3_service.get_presigned_upload_url", return_value=fake_url),
    ):
        resp = await client.post(
            f"{_AUDIO_BASE}/PresignedUpload",
            json={
                "vs_customer_id": 9011,
                "name": "Song",
                "kind": "music",
                "content_type": "audio/mpeg",
            },
            headers=AUTH_HEADERS,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["upload_url"] == fake_url
    assert "s3_key" in body
