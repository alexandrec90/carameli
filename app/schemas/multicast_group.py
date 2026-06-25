from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

logger = logging.getLogger(__name__)


class AddMulticastGroupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension: str = Field(min_length=1, max_length=20)
    description: str = Field(default="", max_length=255)
    extensions: list[str] = Field(default_factory=list)
    users: list[str] = Field(default_factory=list)

    @field_validator("extensions")
    @classmethod
    def extensions_well_formed(cls, value: list[str]) -> list[str]:
        for ext in value:
            if not ext or len(ext) > 20 or "\x00" in ext:
                raise ValueError("each extension must be a non-empty string of at most 20 chars")
        return value

    @field_validator("users")
    @classmethod
    def users_well_formed(cls, value: list[str]) -> list[str]:
        for user in value:
            if not user or len(user) > 64 or "\x00" in user:
                raise ValueError("each user must be a non-empty string of at most 64 chars")
        return value


class MulticastGroupResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    extension: str
    description: str
    extensions: list[str]
    users: list[str]
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class MulticastGroupListResponse(BaseModel):
    multicast_groups: list[MulticastGroupResponse]
    vs_customer_id: int
