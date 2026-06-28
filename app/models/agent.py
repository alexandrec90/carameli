from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class Agent(Base):
    """A configured contact-centre agent (cloudli spec §35). Config-only; real-time
    presence lives in agent_statuses (polled separately)."""

    __tablename__ = "agents"
    __table_args__ = (
        Index(
            "uq_agents_extension_id_active",
            "extension_id",
            unique=True,
            postgresql_where=text("active = true AND extension_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False, index=True
    )
    # Nullable so an agent can exist without an assigned extension.
    # Enforced 1:1 (per active row) via partial unique index in migration 008.
    extension_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("extensions.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(64), nullable=False, server_default="available")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    active: Mapped[bool] = mapped_column(Boolean, default=True)
