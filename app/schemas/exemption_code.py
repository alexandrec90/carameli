from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class AddExemptionCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    description: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=64)
    call_restrictions: str = Field(default="", max_length=255)


class ExemptionCodeResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    description: str
    code: str
    call_restrictions: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class ExemptionCodeListResponse(BaseModel):
    exemption_codes: list[ExemptionCodeResponse]
    vs_customer_id: int
