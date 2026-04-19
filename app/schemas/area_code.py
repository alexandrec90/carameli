from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class AreaCodeInfo(BaseModel):
    area_code: str
    state: str | None = None
    country: str = "US"
    number_type: Literal["local", "toll-free"] = "local"


class AreaCodesResponse(BaseModel):
    area_codes: list[AreaCodeInfo]
    count: int
