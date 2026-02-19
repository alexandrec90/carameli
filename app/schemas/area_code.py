from __future__ import annotations

from typing import List

from pydantic import BaseModel


class AreaCodeInfo(BaseModel):
    area_code: str
    state: str | None = None
    country: str = "US"


class AreaCodesResponse(BaseModel):
    area_codes: List[AreaCodeInfo]
    count: int
