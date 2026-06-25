from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

logger = logging.getLogger(__name__)


class AddWebhookSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    description: str = Field(default="", max_length=255)
    uri: str = Field(min_length=1, max_length=512)
    events: list[str] = Field(default_factory=list)
    enabled: bool = True

    @field_validator("uri")
    @classmethod
    def uri_must_be_http(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("uri must start with http:// or https://")
        return value

    @field_validator("events")
    @classmethod
    def events_well_formed(cls, value: list[str]) -> list[str]:
        for event in value:
            if not event or len(event) > 64 or "\x00" in event:
                raise ValueError("each event must be a non-empty string of at most 64 chars")
        return value


class WebhookSubscriptionResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    description: str
    uri: str
    events: list[str]
    enabled: bool
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class WebhookSubscriptionListResponse(BaseModel):
    subscriptions: list[WebhookSubscriptionResponse]
    vs_customer_id: int
