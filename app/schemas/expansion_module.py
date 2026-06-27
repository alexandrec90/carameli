from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class AddExpansionModuleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    description: str = Field(min_length=1, max_length=255)
    brand: str = Field(min_length=1, max_length=128)
    model: str = Field(min_length=1, max_length=128)


class ExpansionModuleResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    description: str
    brand: str
    model: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class ExpansionModuleListResponse(BaseModel):
    expansion_modules: list[ExpansionModuleResponse]
    vs_customer_id: int
