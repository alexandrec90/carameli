from __future__ import annotations

import logging
import uuid
from datetime import datetime

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class CallEventResponse(BaseModel):
    id: uuid.UUID
    call_sid: str
    direction: str
    from_number: str | None
    to_number: str | None
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int | None
    recording_url: str | None
    status: str | None
    posted: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CallEventListResponse(BaseModel):
    events: list[CallEventResponse]
    vs_customer_id: int


class CallRecordingResponse(BaseModel):
    call_sid: str
    recording_url: str
    duration_seconds: int | None


class WebhookAck(BaseModel):
    """Standard acknowledgement response for webhook handlers."""

    status: str = "ok"
