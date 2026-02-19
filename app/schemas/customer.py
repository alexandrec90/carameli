from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class CustomerCreate(BaseModel):
    vs_customer_id: int
    api_key: str
    twilio_account_sid: str
    twilio_auth_token: str


class CustomerResponse(BaseModel):
    id: uuid.UUID
    vs_customer_id: int
    api_key: str
    twilio_account_sid: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CustomerIdResponse(BaseModel):
    internal_id: uuid.UUID
    vs_customer_id: int
