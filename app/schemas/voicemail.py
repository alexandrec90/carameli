from __future__ import annotations

from pydantic import BaseModel


class VoicemailDropRequest(BaseModel):
    vs_customer_id: int
    extension: str
    msg_drop_number: str
    audio_url: str


class VoicemailDropResponse(BaseModel):
    call_sid: str
    status: str
