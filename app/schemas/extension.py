from __future__ import annotations

import logging
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


class AddExtensionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension_number: str = Field(max_length=20, pattern=r"^[^\x00]*$")
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


# --- Carameli-native REST (/api/v1) -------------------------------------------------
# Resource-oriented bodies for the native API. `vs_customer_id` is optional here: a
# customer-scoped token already identifies its customer, and only an admin token has to
# name one. The legacy /vsapi shapes above stay published until VanillaSoft stops
# calling them.

# Bounds one bulk request so a typo'd range cannot ask for a million rows in one commit.
MAX_EXTENSION_RANGE = 500


class CreateExtensionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extension_number: str = Field(max_length=20, pattern=r"^[^\x00]*$")
    vs_customer_id: int | None = Field(default=None, ge=1, le=2147483647)

    @field_validator("extension_number", mode="before")
    @classmethod
    def reject_null_bytes(cls, value: object) -> object:
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("extension_number must not contain null bytes")
        return value


class CreateExtensionRangeRequest(BaseModel):
    """Bulk create over an inclusive numeric range, committed as one transaction."""

    model_config = ConfigDict(extra="forbid")

    start_extension: int = Field(ge=0)
    end_extension: int = Field(ge=0)
    vs_customer_id: int | None = Field(default=None, ge=1, le=2147483647)

    @model_validator(mode="after")
    def validate_range(self) -> CreateExtensionRangeRequest:
        if self.end_extension < self.start_extension:
            raise ValueError("end_extension must be greater than or equal to start_extension")
        if self.end_extension - self.start_extension + 1 > MAX_EXTENSION_RANGE:
            raise ValueError(f"range must not exceed {MAX_EXTENSION_RANGE} extensions")
        return self


class UpdateExtensionRequest(BaseModel):
    """PATCH body. Only `active: false` is meaningful — extensions are never
    hard-deleted, so deactivation is the single removal operation."""

    model_config = ConfigDict(extra="forbid")

    active: bool


class ExtensionListResponse(BaseModel):
    extensions: list[ExtensionResponse]
