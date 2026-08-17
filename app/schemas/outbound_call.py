from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.core.phone import normalize_phone_number


class OutboundCallRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    from_number: str = Field(min_length=1)  # customer-owned DID (E.164) used as caller ID
    destination_number: str = Field(min_length=1)  # number to dial (E.164)
    extension: str = Field(min_length=1)  # agent extension bridged in when the call is answered
    contact_id: int | None = Field(default=None, ge=1, le=2147483647)

    @field_validator("from_number", "destination_number", mode="before")
    @classmethod
    def normalize_numbers(cls, value: object) -> object:
        return normalize_phone_number(value)

    @field_validator("extension", mode="before")
    @classmethod
    def strip_extension(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class OutboundCallResponse(BaseModel):
    call_sid: str
    status: str
