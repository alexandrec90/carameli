from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base

logger = logging.getLogger(__name__)


class Extension(Base):
    __tablename__ = "extensions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False
    )
    extension_number: Mapped[str] = mapped_column(String(20), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sip_username: Mapped[str] = mapped_column(String(64), nullable=False)
    sip_credential_sid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sip_domain_sid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sip_password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    sip_secret_delivered_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    active: Mapped[bool] = mapped_column(Boolean, default=True)
