from __future__ import annotations

import logging

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

logger = logging.getLogger(__name__)


class PostSciByZipCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension_number: str = Field(pattern=r"^[^\x00]*$")
    zip_code: str = Field(pattern=r"^\d{3}(\d{2})?$")
    enabled: StrictBool = True

    @field_validator("extension_number", mode="before")
    @classmethod
    def reject_null_bytes_ext(cls, value: object) -> object:
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("extension_number must not contain null bytes")
        return value

    @field_validator("zip_code", mode="before")
    @classmethod
    def normalize_zip_code(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("zip_code")
    @classmethod
    def validate_zip_code(cls, value: str) -> str:
        if not value.isdigit() or len(value) not in {3, 5}:
            raise ValueError("zip_code must be numeric and either 3 or 5 digits")
        return value


class UpdateSciUserOptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension_number: str = Field(pattern=r"^[^\x00]*$")
    enabled: StrictBool

    @field_validator("extension_number", mode="before")
    @classmethod
    def reject_null_bytes_ext(cls, value: object) -> object:
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("extension_number must not contain null bytes")
        return value


class SciResponse(BaseModel):
    success: bool
    detail: str | None = None
