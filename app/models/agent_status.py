from __future__ import annotations

import logging
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base

logger = logging.getLogger(__name__)


class AgentStatus(Base):
    """One row per SIP username; upserted on every 30-second poll.

    Mirrors the per-agent presence record that VanillaLand maintained via the
    Clarity API (CMVClarityAPI.cs HUD Phones + Device Status endpoints).
    Jambonz equivalents:
      - call_state  ← GET /v1/Accounts/{sid}/Calls  (active call list)
      - sip_registered ← GET /v1/Accounts/{sid}/registrations (SIP reg list)
    Fields that Clarity exposed but Jambonz has no equivalent for (e.g.
    ``presence`` / availability flag set by the agent) are not stored — they
    would always be NULL and provide no value.
    """

    __tablename__ = "agent_statuses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    extension_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("extensions.id", ondelete="SET NULL"), nullable=True
    )
    # Unique key for upsert — one row per agent regardless of poll frequency.
    sip_username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # call_state values: "idle", "ringing", "on-call"; NULL = unknown / not polled yet.
    call_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    call_sid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sip_registered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    polled_at: Mapped[DateTime] = mapped_column(DateTime, nullable=False, server_default=func.now())
