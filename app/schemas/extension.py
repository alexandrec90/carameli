from __future__ import annotations

import uuid
from datetime import datetime
from typing import List

from pydantic import BaseModel


class AddExtensionRequest(BaseModel):
    vs_customer_id: int
    extension_number: str
    password: str | None = None


class ExtensionResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    extension_number: str
    sip_username: str
    sip_credential_sid: str | None
    twilio_domain_sid: str | None
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AvailableExtensionsResponse(BaseModel):
    available: List[str]
    vs_customer_id: int
