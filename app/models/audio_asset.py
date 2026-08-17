from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class AudioAsset(Base):
    """A customer-owned audio file stored in S3 (cloudli spec §18-22, §25, §29)."""

    __tablename__ = "audio_assets"
    __table_args__ = (
        CheckConstraint(
            "voicemail_drop_code IS NULL OR voicemail_drop_code BETWEEN 1 AND 9",
            name="ck_audio_assets_voicemail_drop_code_range",
        ),
        UniqueConstraint(
            "customer_id",
            "voicemail_drop_code",
            name="uq_audio_assets_customer_voicemail_drop_code",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    voicemail_drop_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    active: Mapped[bool] = mapped_column(Boolean, default=True)
