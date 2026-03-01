from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PostSciByZipCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int
    extension_number: str
    zip_code: str = Field(min_length=3, max_length=5)
    enabled: bool = True

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

    vs_customer_id: int
    extension_number: str
    enabled: bool


class SciResponse(BaseModel):
    success: bool
    detail: str | None = None
