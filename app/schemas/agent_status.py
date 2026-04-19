from __future__ import annotations

import logging
from datetime import UTC, datetime

from pydantic import BaseModel, field_serializer

logger = logging.getLogger(__name__)


class AgentStatusResponse(BaseModel):
    """Per-agent presence snapshot returned by GET /AgentStatus/{customerId}."""

    sip_username: str
    call_state: str | None
    call_sid: str | None
    sip_registered: bool
    polled_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("polled_at")
    def serialize_polled_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()
