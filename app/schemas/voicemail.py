from __future__ import annotations

import logging

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    field_validator,
)

logger = logging.getLogger(__name__)

_E164_PATTERN = r"^\+[1-9]\d{6,14}$"


class VoicemailDropRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension: str = Field(
        validation_alias=AliasChoices("extension", "from_number", "voip_phone_number"),
        pattern=_E164_PATTERN,
    )
    msg_drop_number: str = Field(pattern=_E164_PATTERN)
    audio_url: HttpUrl

    @field_validator("extension", "msg_drop_number", mode="before")
    @classmethod
    def normalize_phone_number(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class VoicemailDropResponse(BaseModel):
    call_sid: str
    status: str
