from __future__ import annotations

from pydantic import BaseModel


class SendSmsRequest(BaseModel):
    from_number: str
    to_number: str
    body: str


class SmsStatusResponse(BaseModel):
    success: bool
    message_sid: str | None = None
    detail: str | None = None


class SmsEnableDisableResponse(BaseModel):
    success: bool
    phone_number: str
    sms_enabled: bool
