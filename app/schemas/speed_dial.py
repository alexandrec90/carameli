from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class AddSpeedDialRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    code: str = Field(min_length=1, max_length=10)
    phone_number: str = Field(min_length=1, max_length=20)
    description: str = Field(default="", max_length=255)


class SpeedDialResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    code: str
    phone_number: str
    description: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class SpeedDialListResponse(BaseModel):
    speed_dials: list[SpeedDialResponse]
    vs_customer_id: int
