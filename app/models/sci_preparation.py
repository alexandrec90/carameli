from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class SciPreparation(Base):
    """Short-lived caller-ID selection for one CRM contact call."""

    __tablename__ = "sci_preparations"
    __table_args__ = (
        UniqueConstraint(
            "customer_id",
            "contact_id",
            name="uq_sci_preparations_customer_contact",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False, index=True
    )
    extension_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("extensions.id"), nullable=False
    )
    contact_id: Mapped[int] = mapped_column(Integer, nullable=False)
    destination_number: Mapped[str] = mapped_column(String(20), nullable=False)
    candidate_area_codes: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    selected_phone_line_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phone_lines.id"), nullable=False
    )
    selected_caller_id: Mapped[str] = mapped_column(String(20), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
