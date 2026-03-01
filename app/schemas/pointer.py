from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

_E164_PATTERN = r"^\+[1-9]\d{6,14}$"


class _PointerBaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int
    phone_number: str = Field(pattern=_E164_PATTERN)
    extension_number: str

    @field_validator("phone_number", mode="before")
    @classmethod
    def normalize_phone_number(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class AddPointerRequest(_PointerBaseRequest):
    pass


class DeletePointerRequest(_PointerBaseRequest):
    pass


class PointerResponse(BaseModel):
    success: bool
    detail: str | None = None
