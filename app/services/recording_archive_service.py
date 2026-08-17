from __future__ import annotations

import asyncio
import logging
import tempfile
import uuid
import zipfile
from urllib.parse import parse_qs, unquote, urlparse

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import async_session_factory
from app.models.recording_archive import RecordingArchive
from app.repositories.recording_archive_repo import RecordingArchiveRepo
from app.schemas.recording_archive import RecordingArchiveFileRequest
from app.services import call_event_service, recording_links, s3_service

logger = logging.getLogger(__name__)


class ArchiveRequestError(ValueError):
    pass


def call_sid_from_public_url(url: str) -> str:
    parsed = urlparse(url)
    expected = urlparse(settings.jambonz_webhook_base_url)
    if parsed.scheme != expected.scheme or parsed.netloc != expected.netloc:
        raise ArchiveRequestError("Recording URL must be a Carameli public recording link")
    prefix = f"{expected.path.rstrip('/')}/recordings/"
    if not parsed.path.startswith(prefix):
        raise ArchiveRequestError("Recording URL must be a Carameli public recording link")
    call_sid = unquote(parsed.path[len(prefix) :])
    if not call_sid or "/" in call_sid:
        raise ArchiveRequestError("Recording URL contains an invalid call id")
    token = parse_qs(parsed.query).get("token", [""])[0]
    if not recording_links.verify_recording_token(call_sid, token):
        raise ArchiveRequestError("Recording URL token is invalid")
    return call_sid


def s3_key_from_recording(recording_url: str) -> str:
    parsed = urlparse(recording_url)
    if parsed.scheme != "s3" or parsed.netloc != settings.s3_bucket:
        raise ArchiveRequestError("Bulk archives require recordings in the configured S3 bucket")
    key = parsed.path.lstrip("/")
    if not key:
        raise ArchiveRequestError("Recording has no S3 object key")
    return key


async def resolve_items(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    files: list[RecordingArchiveFileRequest],
) -> list[tuple[uuid.UUID, str, uuid.UUID | None]]:
    if len(files) > settings.recording_archive_max_files:
        raise ArchiveRequestError(
            f"Archive cannot exceed {settings.recording_archive_max_files} files"
        )
    filenames = [item.filename.casefold() for item in files]
    if len(filenames) != len(set(filenames)):
        raise ArchiveRequestError("Archive filenames must be unique")

    resolved: list[tuple[uuid.UUID, str, uuid.UUID | None]] = []
    for item in files:
        call_sid = call_sid_from_public_url(item.url)
        event = await call_event_service.get_by_call_sid_for_customer(
            session, call_sid, customer_id
        )
        if not event or not event.recording_url:
            raise ArchiveRequestError("Recording not found for customer")
        s3_key_from_recording(event.recording_url)
        resolved.append((event.id, item.filename, item.unique_id))
    return resolved


async def create_archive(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    export_id: int,
    archive_name: str,
    items: list[tuple[uuid.UUID, str, uuid.UUID | None]],
) -> tuple[RecordingArchive, bool]:
    repo = RecordingArchiveRepo(session)
    existing = await repo.get_by_export(customer_id, export_id)
    if existing:
        return existing, False
    try:
        return (
            await repo.create(
                customer_id=customer_id,
                export_id=export_id,
                archive_name=archive_name,
                items=items,
            ),
            True,
        )
    except IntegrityError:
        await session.rollback()
        existing = await repo.get_by_export(customer_id, export_id)
        if existing:
            return existing, False
        raise


def _build_and_upload_zip(archive: RecordingArchive, sources: list[tuple[str, str]]) -> str:
    s3_key = f"archives/{archive.customer_id}/{archive.id}/{archive.archive_name}.zip"
    total_bytes = 0
    with tempfile.SpooledTemporaryFile(max_size=20 * 1024 * 1024) as output:
        with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for filename, recording_url in sources:
                source_key = s3_key_from_recording(recording_url)
                payload = s3_service.download_object(
                    source_key, settings.recording_archive_max_file_bytes
                )
                total_bytes += len(payload)
                if total_bytes > settings.recording_archive_max_total_bytes:
                    raise ArchiveRequestError(
                        "Archive exceeds the configured total recording-size limit"
                    )
                zip_file.writestr(filename, payload)
        s3_service.upload_fileobj(output, s3_key, "application/zip")
    return s3_key


async def build_recording_archive(ctx: dict, archive_id: str) -> None:
    """ARQ job that builds one bounded ZIP and persists terminal state."""
    del ctx
    parsed_id = uuid.UUID(archive_id)
    async with async_session_factory() as session:
        repo = RecordingArchiveRepo(session)
        archive = await repo.get_by_id(parsed_id)
        if not archive:
            logger.error("Recording archive job references missing archive_id=%s", archive_id)
            return
        await repo.set_status(archive, "processing")
        try:
            sources = await repo.list_sources(archive.id)
            if len(sources) != archive.file_count:
                raise ArchiveRequestError("One or more archive recordings are no longer available")
            s3_key = await asyncio.to_thread(_build_and_upload_zip, archive, sources)
            await repo.set_status(archive, "completed", s3_key=s3_key)
            logger.info("Recording archive completed archive_id=%s", archive.id)
        except Exception:
            await repo.set_status(archive, "failed", error="Archive creation failed")
            logger.exception("Recording archive failed archive_id=%s", archive.id)
            raise
