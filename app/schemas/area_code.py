from __future__ import annotations

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class AreaCodeInfo(BaseModel):
    area_code: str
    state: str | None = None
    country: str = "US"


class AreaCodesResponse(BaseModel):
    area_codes: list[AreaCodeInfo]
    count: int
