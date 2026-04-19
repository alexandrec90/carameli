from __future__ import annotations

import logging
from datetime import datetime

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class RecordingExportResponse(BaseModel):
    call_sid: str
    download_url: str
    expires_at: datetime | None = None
