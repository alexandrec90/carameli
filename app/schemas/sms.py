from __future__ import annotations

import logging

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SendSmsRequest(BaseModel):
    from_number: str
    to_number: str = Field(min_length=2)
    body: str


class SmsStatusResponse(BaseModel):
    success: bool
    message_sid: str | None = None
    detail: str | None = None


class SmsEnableDisableResponse(BaseModel):
    success: bool
    phone_number: str
    sms_enabled: bool
