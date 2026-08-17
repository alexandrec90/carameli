from __future__ import annotations

import uuid
from pathlib import PurePath

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class RecordingArchiveFileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    url: str = Field(validation_alias=AliasChoices("url", "Url"), min_length=1, max_length=2048)
    filename: str = Field(
        validation_alias=AliasChoices("filename", "VsFilename"),
        min_length=1,
        max_length=255,
    )
    unique_id: uuid.UUID | None = Field(
        default=None, validation_alias=AliasChoices("unique_id", "UniqueId")
    )

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned in {".", ".."} or PurePath(cleaned).name != cleaned or "\\" in cleaned:
            raise ValueError("filename must be a plain file name without directories")
        return cleaned


class RecordingArchiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    vs_customer_id: int = Field(
        validation_alias=AliasChoices("vs_customer_id", "vsCustomerid", "vsCustomerId"),
        ge=1,
        le=2147483647,
    )
    export_id: int = Field(
        validation_alias=AliasChoices("export_id", "exportid", "exportId"),
        ge=1,
        le=2147483647,
    )
    archive_name: str = Field(
        validation_alias=AliasChoices("archive_name", "archiveName"),
        min_length=1,
        max_length=255,
    )
    files: list[RecordingArchiveFileRequest] = Field(
        validation_alias=AliasChoices("files", "file"), min_length=1
    )

    @field_validator("archive_name")
    @classmethod
    def safe_archive_name(cls, value: str) -> str:
        cleaned = value.strip().removesuffix(".zip")
        if (
            not cleaned
            or cleaned in {".", ".."}
            or PurePath(cleaned).name != cleaned
            or "\\" in cleaned
        ):
            raise ValueError("archive_name must be a plain name without directories")
        return cleaned


class RecordingArchiveResponse(BaseModel):
    export_id: int
    archive_name: str
    status: str
    file_count: int
    download_url: str | None = None
    error: str | None = None
