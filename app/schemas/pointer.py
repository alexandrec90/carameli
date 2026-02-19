from __future__ import annotations

from pydantic import BaseModel


class AddPointerRequest(BaseModel):
    vs_customer_id: int
    phone_number: str
    extension_number: str


class DeletePointerRequest(BaseModel):
    vs_customer_id: int
    phone_number: str
    extension_number: str


class PointerResponse(BaseModel):
    success: bool
    detail: str | None = None
