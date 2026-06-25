from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer

logger = logging.getLogger(__name__)


class AddConferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    number: str = Field(min_length=1, max_length=20)
    description: str = Field(default="", max_length=255)
    max_participants: int = Field(default=10, ge=2, le=1000)
    recorded_calls: bool = False


class ConferenceResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    number: str
    description: str
    max_participants: int
    recorded_calls: bool
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class ConferenceListResponse(BaseModel):
    conferences: list[ConferenceResponse]
    vs_customer_id: int
