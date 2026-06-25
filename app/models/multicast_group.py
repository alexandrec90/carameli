from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base

logger = logging.getLogger(__name__)


class MulticastGroup(Base):
    """A multi-cast intercom: one source broadcasts to subscriber extensions (cloudli spec §16)."""

    __tablename__ = "multicast_groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False
    )
    extension: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    extensions: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), nullable=False, server_default=text("'{}'::varchar[]")
    )
    users: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, server_default=text("'{}'::varchar[]")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    active: Mapped[bool] = mapped_column(Boolean, default=True)
