from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import verify_api_key

router = APIRouter(prefix="/vg/1.0.0", tags=["internal"])

# A separate logger so frontend entries are clearly labelled in the file.
_fe_logger = logging.getLogger("frontend")

_LEVEL_MAP: dict[str, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}


class FrontendLogEntry(BaseModel):
    level: str = "info"
    message: str
    context: dict[str, Any] | None = None


class FrontendLogBatch(BaseModel):
    entries: list[FrontendLogEntry]


@router.post("/frontend-logs", status_code=204)
async def ingest_frontend_logs(
    batch: FrontendLogBatch,
    _: Annotated[str, Depends(verify_api_key)],
) -> None:
    """Receive structured React frontend logs and write them to the server log file."""
    for entry in batch.entries:
        level = _LEVEL_MAP.get(entry.level.lower(), logging.INFO)
        extra = f" | context={entry.context}" if entry.context else ""
        _fe_logger.log(level, "[FRONTEND] %s%s", entry.message, extra)
