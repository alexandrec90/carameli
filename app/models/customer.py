from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vs_customer_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    api_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    twilio_account_sid: Mapped[str] = mapped_column(String(64), nullable=False)
    twilio_auth_token: Mapped[str] = mapped_column(String(128), nullable=False)
    twilio_sip_domain_sid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
