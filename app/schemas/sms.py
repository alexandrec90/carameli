from __future__ import annotations

import logging
import uuid
from datetime import datetime

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


class SmsMessageResponse(BaseModel):
    id: uuid.UUID
    direction: str
    from_number: str
    to_number: str
    body: str
    message_sid: str | None
    delivery_status: str | None
    error_code: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SmsMessageListResponse(BaseModel):
    messages: list[SmsMessageResponse]
    vs_customer_id: int
