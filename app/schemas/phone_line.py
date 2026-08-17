from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

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
    branch_id: int | None
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


# --- Carameli-native REST (/api/v1) -------------------------------------------------
# One resource, real status codes, no success-in-body envelope. The four legacy verbs
# (Deactivate, UpdateCallRecording, SetAutoAttendant, VsMessaging/Sms/Enable|Disable)
# collapse into a single PATCH; `CarameliClient` reconstructs the CMV shapes.


class CreatePhoneLineRequest(BaseModel):
    """Provision a DID, either a named number or the first free one in an area code."""

    model_config = ConfigDict(extra="forbid")

    phone_number: str | None = Field(default=None, min_length=1)
    area_code: str | None = Field(default=None, min_length=1)
    country_code: str = Field(default="US", min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
    vs_customer_id: int | None = Field(default=None, ge=1, le=2147483647)

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, v: str) -> str:
        return _validate_country_code(v)

    @model_validator(mode="after")
    def exactly_one_selector(self) -> CreatePhoneLineRequest:
        if bool(self.phone_number) == bool(self.area_code):
            raise ValueError("provide exactly one of phone_number or area_code")
        return self


class UpdatePhoneLineRequest(BaseModel):
    """PATCH body; every field is optional and only the ones sent are applied.

    ``active`` accepts ``false`` only — releasing a DID at the carrier is not
    reversible from here, so re-activation is a new provisioning request.
    """

    model_config = ConfigDict(extra="forbid")

    sms_enabled: bool | None = None
    recording_enabled: bool | None = None
    auto_attendant_enabled: bool | None = None
    auto_attendant_max_digits: int | None = Field(default=None, ge=1, le=9)
    active: bool | None = None

    @model_validator(mode="after")
    def validate_transitions(self) -> UpdatePhoneLineRequest:
        fields = self.model_fields_set
        if not fields:
            raise ValueError("at least one field must be provided")
        if self.active is True:
            raise ValueError("active cannot be set back to true; provision a new line instead")
        if self.auto_attendant_enabled is True and self.auto_attendant_max_digits is None:
            raise ValueError(
                "auto_attendant_max_digits is required when auto_attendant_enabled is true"
            )
        return self


class PhoneLineListResponse(BaseModel):
    phone_lines: list[PhoneLineResponse]
