from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

logger = logging.getLogger(__name__)


def _validate_extensions(value: list[str]) -> list[str]:
    for ext in value:
        if not ext or len(ext) > 20 or "\x00" in ext:
            raise ValueError("each extension must be a non-empty string of at most 20 chars")
    return value


class AddGroupExtensionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    description: str = Field(default="", max_length=255)
    number: str = Field(min_length=1, max_length=20)
    subscribed_extensions: list[str] = Field(default_factory=list)

    @field_validator("subscribed_extensions")
    @classmethod
    def extensions_well_formed(cls, value: list[str]) -> list[str]:
        return _validate_extensions(value)


class GroupExtensionResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    description: str
    number: str
    subscribed_extensions: list[str]
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class GroupExtensionListResponse(BaseModel):
    group_extensions: list[GroupExtensionResponse]
    vs_customer_id: int
