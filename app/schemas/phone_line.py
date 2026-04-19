from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_serializer, field_validator

logger = logging.getLogger(__name__)

_COUNTRY_CODE_RE = re.compile(r"^[A-Z]{2}$")


def _validate_country_code(v: str) -> str:
    upper = v.upper()
    if not _COUNTRY_CODE_RE.match(upper):
        raise ValueError("country_code must be a 2-letter ISO-3166-1 alpha-2 code")
    return upper


class AddPhoneLineByNumber(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    phone_number: str = Field(min_length=1)
    country_code: str = Field(default="US", min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, v: str) -> str:
        return _validate_country_code(v)


class AddPhoneLineByAreaCode(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    area_code: str = Field(min_length=1)
    country_code: str = Field(default="US", min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, v: str) -> str:
        return _validate_country_code(v)


AddPhoneLineRequest = AddPhoneLineByNumber | AddPhoneLineByAreaCode


class PhoneLineResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    phone_number: str
    provider_sid: str
    sms_enabled: bool
    recording_enabled: bool
    active: bool
    auto_attendant_enabled: bool
    auto_attendant_max_digits: int | None
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


class SetAutoAttendantRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    phone_number: str
    enabled: bool
    max_digits: int | None = Field(default=None, ge=1, le=9)
