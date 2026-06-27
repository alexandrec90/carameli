from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class AddCallQueueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    name: str = Field(min_length=1, max_length=255)
    strategy: str = Field(default="round-robin", max_length=64)


class CallQueueResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    name: str
    strategy: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class CallQueueListResponse(BaseModel):
    call_queues: list[CallQueueResponse]
    vs_customer_id: int
