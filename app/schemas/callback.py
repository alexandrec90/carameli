from __future__ import annotations

import logging

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class CallbackRequest(BaseModel):
    vs_customer_id: int = Field(ge=1, le=2147483647)
    extension: str = Field(min_length=1)
    destination_number: str = Field(min_length=1)


class CallbackResponse(BaseModel):
    call_sid: str
    status: str
