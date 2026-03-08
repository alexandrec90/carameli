from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class CustomerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int
    api_key: str | None = None

    @field_validator("api_key", mode="before")
    @classmethod
    def normalize_string_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class CustomerResponse(BaseModel):
    id: uuid.UUID
    vs_customer_id: int
    api_key: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CustomerIdResponse(BaseModel):
    internal_id: uuid.UUID
    vs_customer_id: int
