from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class RecordingArchive(Base):
    __tablename__ = "recording_archives"
    __table_args__ = (
        UniqueConstraint(
            "customer_id",
            "export_id",
            name="uq_recording_archives_customer_export",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False, index=True
    )
    export_id: Mapped[int] = mapped_column(Integer, nullable=False)
    archive_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    file_count: Mapped[int] = mapped_column(Integer, nullable=False)
    s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class RecordingArchiveItem(Base):
    __tablename__ = "recording_archive_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    archive_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recording_archives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    call_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("call_events.id"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    unique_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
