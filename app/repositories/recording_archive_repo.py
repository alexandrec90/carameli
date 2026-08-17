from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_event import CallEvent
from app.models.recording_archive import RecordingArchive, RecordingArchiveItem


class RecordingArchiveRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        customer_id: uuid.UUID,
        export_id: int,
        archive_name: str,
        items: list[tuple[uuid.UUID, str, uuid.UUID | None]],
    ) -> RecordingArchive:
        archive = RecordingArchive(
            customer_id=customer_id,
            export_id=export_id,
            archive_name=archive_name,
            status="pending",
            file_count=len(items),
        )
        self.session.add(archive)
        await self.session.flush()
        self.session.add_all(
            [
                RecordingArchiveItem(
                    archive_id=archive.id,
                    call_event_id=call_event_id,
                    filename=filename,
                    unique_id=unique_id,
                )
                for call_event_id, filename, unique_id in items
            ]
        )
        await self.session.commit()
        await self.session.refresh(archive)
        return archive

    async def get_by_export(
        self, customer_id: uuid.UUID, export_id: int
    ) -> RecordingArchive | None:
        result = await self.session.execute(
            select(RecordingArchive).where(
                RecordingArchive.customer_id == customer_id,
                RecordingArchive.export_id == export_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, archive_id: uuid.UUID) -> RecordingArchive | None:
        result = await self.session.execute(
            select(RecordingArchive).where(RecordingArchive.id == archive_id)
        )
        return result.scalar_one_or_none()

    async def list_sources(self, archive_id: uuid.UUID) -> list[tuple[str, str]]:
        result = await self.session.execute(
            select(RecordingArchiveItem.filename, CallEvent.recording_url)
            .join(CallEvent, CallEvent.id == RecordingArchiveItem.call_event_id)
            .where(RecordingArchiveItem.archive_id == archive_id)
            .order_by(RecordingArchiveItem.filename)
        )
        return [(row.filename, row.recording_url) for row in result.all() if row.recording_url]

    async def set_status(
        self,
        archive: RecordingArchive,
        status: str,
        *,
        s3_key: str | None = None,
        error: str | None = None,
    ) -> RecordingArchive:
        archive.status = status
        archive.s3_key = s3_key
        archive.error = error
        archive.completed_at = (
            datetime.now(UTC).replace(tzinfo=None) if status == "completed" else None
        )
        await self.session.commit()
        await self.session.refresh(archive)
        return archive
