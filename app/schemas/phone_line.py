from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_serializer

logger = logging.getLogger(__name__)


class AddPhoneLineByNumber(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    phone_number: str = Field(min_length=1)


class AddPhoneLineByAreaCode(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    area_code: str = Field(min_length=1)


AddPhoneLineRequest = AddPhoneLineByNumber | AddPhoneLineByAreaCode


class PhoneLineResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    phone_number: str
    provider_sid: str
    sms_enabled: bool
    recording_enabled: bool
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class PhoneLineCountResponse(BaseModel):
    count: int
    vs_customer_id: int


class UpdateRecordingRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    phone_number: str
    enabled: bool


class DeactivatePhoneLineRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    phone_number: str
