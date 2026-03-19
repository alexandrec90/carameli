from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_serializer, field_validator

logger = logging.getLogger(__name__)


class AddExtensionRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension_number: str = Field(max_length=20)
    password: str | None = None

    @field_validator("extension_number", mode="before")
    @classmethod
    def reject_null_bytes(cls, value: object) -> object:
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("extension_number must not contain null bytes")
        return value


class ExtensionResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    extension_number: str
    sip_username: str
    sip_credential_sid: str | None
    sip_domain_sid: str | None
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class AvailableExtensionsResponse(BaseModel):
    available: list[str]
    vs_customer_id: int
