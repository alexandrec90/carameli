from __future__ import annotations

import logging

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.phone import normalize_phone_number

logger = logging.getLogger(__name__)

_E164_PATTERN = r"^\+[1-9]\d{6,14}$"


class _PointerBaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    phone_number: str = Field(pattern=_E164_PATTERN)
    extension_number: str

    @field_validator("phone_number", mode="before")
    @classmethod
    def normalize_phone_number(cls, value: object) -> object:
        return normalize_phone_number(value)


class AddPointerRequest(_PointerBaseRequest):
    pass


class DeletePointerRequest(_PointerBaseRequest):
    pass


class PointerResponse(BaseModel):
    success: bool
    detail: str | None = None
