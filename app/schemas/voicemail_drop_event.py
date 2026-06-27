from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, field_serializer


class VoicemailDropEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    customer_id: uuid.UUID
    to_number: str
    audio_asset_id: uuid.UUID | None = None
    call_sid: str | None = None
    status: str
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class VoicemailDropEventListResponse(BaseModel):
    events: list[VoicemailDropEventResponse]
    vs_customer_id: int
