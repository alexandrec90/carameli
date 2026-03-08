from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class AddPhoneLineRequest(BaseModel):
    vs_customer_id: int
    area_code: str | None = None
    phone_number: str | None = None


class PhoneLineResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    phone_number: str
    provider_sid: str
    sms_enabled: bool
    recording_enabled: bool
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PhoneLineCountResponse(BaseModel):
    count: int
    vs_customer_id: int


class UpdateRecordingRequest(BaseModel):
    vs_customer_id: int
    phone_number: str
    enabled: bool


class DeactivatePhoneLineRequest(BaseModel):
    vs_customer_id: int
    phone_number: str
