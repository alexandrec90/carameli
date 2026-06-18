from __future__ import annotations

import logging

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class OutboundCallRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    from_number: str = Field(min_length=1)  # customer-owned DID (E.164) used as caller ID
    destination_number: str = Field(min_length=1)  # number to dial (E.164)
    extension: str = Field(min_length=1)  # agent extension bridged in when the call is answered


class OutboundCallResponse(BaseModel):
    call_sid: str
    status: str
