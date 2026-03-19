from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

logger = logging.getLogger(__name__)


class CustomerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    api_key: str | None = None

    @field_validator("vs_customer_id", mode="before")
    @classmethod
    def reject_bool_vs_customer_id(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("vs_customer_id must be an integer, not a boolean")
        return value

    @field_validator("api_key", mode="before")
    @classmethod
    def normalize_string_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.replace("\x00", "").strip()
        return value


class CustomerResponse(BaseModel):
    id: uuid.UUID
    vs_customer_id: int
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class CustomerCreateResponse(CustomerResponse):
    """Returned only on POST /Create — includes the API key for one-time display."""

    write_only: ClassVar = True
    # api_key exposed only on initial create; not included in list/get responses
    api_key: str


class CustomerIdResponse(BaseModel):
    internal_id: uuid.UUID
    vs_customer_id: int
