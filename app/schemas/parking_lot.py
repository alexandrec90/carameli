from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer

logger = logging.getLogger(__name__)


class AddParkingLotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    description: str = Field(default="", max_length=255)
    extension: str = Field(min_length=1, max_length=20)
    ring_back_time_limit: int = Field(default=30, ge=1, le=3600)


class ParkingLotResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    description: str
    extension: str
    ring_back_time_limit: int
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class ParkingLotListResponse(BaseModel):
    parking_lots: list[ParkingLotResponse]
    vs_customer_id: int
