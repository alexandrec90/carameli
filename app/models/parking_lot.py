from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base

logger = logging.getLogger(__name__)


class ParkingLot(Base):
    """A call-parking extension config; live slot state is deferred (cloudli spec §10)."""

    __tablename__ = "parking_lots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    extension: Mapped[str] = mapped_column(String(20), nullable=False)
    ring_back_time_limit: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("30")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    active: Mapped[bool] = mapped_column(Boolean, default=True)
