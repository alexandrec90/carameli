from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class PresignedUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    name: str = Field(min_length=1, max_length=255)
    kind: str = Field(min_length=1, max_length=32)
    content_type: str = Field(default="audio/mpeg", max_length=64)


class PresignedUploadResponse(BaseModel):
    upload_url: str
    s3_key: str


class ConfirmAudioAssetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vs_customer_id: int = Field(ge=1, le=2147483647)
    name: str = Field(min_length=1, max_length=255)
    kind: str = Field(min_length=1, max_length=32)
    s3_key: str = Field(min_length=1, max_length=512)
    duration_seconds: int | None = None


class AudioAssetResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    kind: str
    name: str
    s3_key: str
    playback_url: str | None = None
    duration_seconds: int | None = None
    active: bool
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()


class AudioAssetListResponse(BaseModel):
    assets: list[AudioAssetResponse]
    vs_customer_id: int
