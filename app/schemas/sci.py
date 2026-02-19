from __future__ import annotations

from pydantic import BaseModel


class PostSciByZipCodeRequest(BaseModel):
    vs_customer_id: int
    extension_number: str
    zip_code: str
    enabled: bool = True


class UpdateSciUserOptionRequest(BaseModel):
    vs_customer_id: int
    extension_number: str
    enabled: bool


class SciResponse(BaseModel):
    success: bool
    detail: str | None = None
