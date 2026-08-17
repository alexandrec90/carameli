from __future__ import annotations

import io
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.core.redis import get_arq_redis
from app.main import app
from app.repositories.recording_archive_repo import RecordingArchiveRepo
from app.schemas.customer import CustomerCreate
from app.services import call_event_service, customer_service, recording_archive_service
from app.services.recording_links import public_recording_url
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_URL = "/vsapi/1.0.0/VsArchive"


async def test_archive_request_is_safe_queued_and_idempotent(
    client, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    customer = await customer_service.create(
        db_session, CustomerCreate(vs_customer_id=9430, api_key="archive-key-9430")
    )
    await call_event_service.create_from_webhook(
        db_session,
        customer.id,
        {
            "CallSid": "archive-call-9430",
            "CallStatus": "completed",
            "RecordingUrl": "s3://recordings-test/calls/9430.mp3",
        },
    )
    monkeypatch.setattr(settings, "s3_bucket", "recordings-test")
    queue = SimpleNamespace(enqueue_job=AsyncMock(return_value=object()))
    app.dependency_overrides[get_arq_redis] = lambda: queue
    request = {
        "vsCustomerid": 9430,
        "exportid": 730,
        "archiveName": "August calls",
        "file": [
            {
                "Url": public_recording_url("archive-call-9430"),
                "VsFilename": "call-9430.mp3",
                "UniqueId": str(uuid.uuid4()),
            }
        ],
    }

    with patch("app.services.s3_service.is_configured", return_value=True):
        response = await client.post(_URL, json=request, headers=AUTH_HEADERS)
        repeated = await client.post(_URL, json=request, headers=AUTH_HEADERS)
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "pending"
    assert repeated.status_code == 202
    queue.enqueue_job.assert_awaited_once()

    status = await client.get(f"{_URL}/9430/730", headers=AUTH_HEADERS)
    assert status.status_code == 200
    assert status.json()["file_count"] == 1


async def test_archive_rejects_external_and_path_traversal_urls(
    client, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    await customer_service.create(
        db_session, CustomerCreate(vs_customer_id=9431, api_key="archive-key-9431")
    )
    monkeypatch.setattr(settings, "s3_bucket", "recordings-test")
    queue = SimpleNamespace(enqueue_job=AsyncMock(return_value=object()))
    app.dependency_overrides[get_arq_redis] = lambda: queue
    base = {
        "vsCustomerid": 9431,
        "exportid": 731,
        "archiveName": "Unsafe",
    }
    with patch("app.services.s3_service.is_configured", return_value=True):
        external = await client.post(
            _URL,
            json={
                **base,
                "file": [{"Url": "https://example.com/private.mp3", "VsFilename": "x.mp3"}],
            },
            headers=AUTH_HEADERS,
        )
        traversal = await client.post(
            _URL,
            json={
                **base,
                "exportid": 732,
                "file": [
                    {
                        "Url": public_recording_url("anything"),
                        "VsFilename": "../escape.mp3",
                    }
                ],
            },
            headers=AUTH_HEADERS,
        )
    assert external.status_code == 422
    assert traversal.status_code == 422
    queue.enqueue_job.assert_not_awaited()


async def test_archive_worker_builds_zip_from_configured_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "s3_bucket", "recordings-test")
    uploaded: dict[str, object] = {}

    def capture_upload(fileobj, key: str, content_type: str) -> None:
        fileobj.seek(0)
        uploaded.update(data=fileobj.read(), key=key, content_type=content_type)

    archive = SimpleNamespace(id=uuid.uuid4(), customer_id=uuid.uuid4(), archive_name="calls")
    with (
        patch(
            "app.services.s3_service.download_object",
            side_effect=[b"first", b"second"],
        ),
        patch("app.services.s3_service.upload_fileobj", side_effect=capture_upload),
    ):
        key = recording_archive_service._build_and_upload_zip(
            archive,
            [
                ("one.mp3", "s3://recordings-test/one"),
                ("two.mp3", "s3://recordings-test/two"),
            ],
        )

    assert key == f"archives/{archive.customer_id}/{archive.id}/calls.zip"
    assert uploaded["content_type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(uploaded["data"])) as result:
        assert result.namelist() == ["one.mp3", "two.mp3"]
        assert result.read("one.mp3") == b"first"
        assert result.read("two.mp3") == b"second"


def _session_factory(db_session):
    """Give the ARQ job the test's rollback-wrapped session."""

    def factory():
        class _FakeCM:
            async def __aenter__(self):
                return db_session

            async def __aexit__(self, *args):
                return None

        return _FakeCM()

    return factory


async def _archive_with_items(
    db_session, *, vs_customer_id: int, export_id: int, recordings: list[str | None]
):
    customer = await customer_service.create(
        db_session,
        CustomerCreate(vs_customer_id=vs_customer_id, api_key=f"archive-job-{vs_customer_id}"),
    )
    items: list[tuple[uuid.UUID, str, uuid.UUID | None]] = []
    for index, recording_url in enumerate(recordings):
        payload = {
            "CallSid": f"archive-job-{vs_customer_id}-{index}",
            "CallStatus": "completed",
        }
        if recording_url:
            payload["RecordingUrl"] = recording_url
        event = await call_event_service.create_from_webhook(db_session, customer.id, payload)
        items.append((event.id, f"call-{index}.mp3", None))
    archive = await RecordingArchiveRepo(db_session).create(
        customer_id=customer.id,
        export_id=export_id,
        archive_name="August calls",
        items=items,
    )
    return archive


async def test_archive_job_completes_and_records_the_s3_key(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "s3_bucket", "recordings-test")
    archive = await _archive_with_items(
        db_session,
        vs_customer_id=9431,
        export_id=731,
        recordings=["s3://recordings-test/calls/a.mp3", "s3://recordings-test/calls/b.mp3"],
    )
    monkeypatch.setattr(
        recording_archive_service, "async_session_factory", _session_factory(db_session)
    )

    with (
        patch("app.services.s3_service.download_object", side_effect=[b"a", b"b"]),
        patch("app.services.s3_service.upload_fileobj") as upload,
    ):
        await recording_archive_service.build_recording_archive({}, str(archive.id))

    upload.assert_called_once()
    refreshed = await RecordingArchiveRepo(db_session).get_by_id(archive.id)
    assert refreshed is not None
    assert refreshed.status == "completed"
    assert refreshed.s3_key == f"archives/{archive.customer_id}/{archive.id}/August calls.zip"
    assert refreshed.error is None
    assert refreshed.completed_at is not None


async def test_archive_job_marks_failed_when_a_recording_disappeared(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "s3_bucket", "recordings-test")
    archive = await _archive_with_items(
        db_session,
        vs_customer_id=9432,
        export_id=732,
        recordings=["s3://recordings-test/calls/a.mp3", None],
    )
    monkeypatch.setattr(
        recording_archive_service, "async_session_factory", _session_factory(db_session)
    )

    with (
        patch("app.services.s3_service.download_object") as download,
        pytest.raises(recording_archive_service.ArchiveRequestError),
    ):
        await recording_archive_service.build_recording_archive({}, str(archive.id))

    download.assert_not_called()
    refreshed = await RecordingArchiveRepo(db_session).get_by_id(archive.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error == "Archive creation failed"
    assert refreshed.s3_key is None


async def test_archive_job_ignores_a_missing_archive_row(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        recording_archive_service, "async_session_factory", _session_factory(db_session)
    )
    with patch("app.services.s3_service.download_object") as download:
        await recording_archive_service.build_recording_archive({}, str(uuid.uuid4()))
    download.assert_not_called()
