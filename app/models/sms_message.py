from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base

logger = logging.getLogger(__name__)


class SmsMessage(Base):
    __tablename__ = "sms_messages"
    __table_args__ = (
        Index(
            "ix_sms_messages_unposted_created_at",
            "created_at",
            postgresql_where=text("posted = false"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True, index=True
    )
    phone_line_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phone_lines.id"), nullable=True, index=True
    )
    message_sid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)  # "inbound" | "outbound"
    from_number: Mapped[str] = mapped_column(String(20), nullable=False)
    to_number: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    delivery_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # True once the inbound message has been forwarded to CRM.
    posted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return (
            f"<SmsMessage id={self.id} direction={self.direction}"
            f" message_sid={self.message_sid} status={self.delivery_status}>"
        )
