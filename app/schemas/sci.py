from __future__ import annotations

import logging

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, StrictBool, field_validator

from app.core.phone import normalize_phone_number

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


class PrecallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    vs_customer_id: int = Field(
        validation_alias=AliasChoices("vs_customer_id", "vsCustomerId"),
        ge=1,
        le=2147483647,
    )
    from_extension: str = Field(
        validation_alias=AliasChoices("from_extension", "fromExtension"),
        min_length=1,
        max_length=20,
    )
    contact_id: int = Field(
        validation_alias=AliasChoices("contact_id", "uniqueId"),
        ge=1,
        le=2147483647,
    )
    destination_number: str = Field(
        validation_alias=AliasChoices("destination_number", "toTn"),
        min_length=1,
        max_length=20,
    )
    area_codes: list[str] = Field(
        validation_alias=AliasChoices("area_codes", "areaCodes"),
        min_length=1,
        max_length=20,
    )

    @field_validator("destination_number", mode="before")
    @classmethod
    def normalize_destination(cls, value: object) -> object:
        return normalize_phone_number(value)

    @field_validator("area_codes")
    @classmethod
    def validate_area_codes(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(len(value) != 3 or not value.isdigit() for value in normalized):
            raise ValueError("area_codes must contain three-digit NANP area codes")
        return list(dict.fromkeys(normalized))


class PrecallResponse(BaseModel):
    success: bool
    selected_caller_id: str
    expires_at: str
