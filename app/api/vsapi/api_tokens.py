from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.services import customer_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsToken", tags=["api-tokens"])


class ApiTokenRow(BaseModel):
    token_masked: str
    enabled: bool


class ApiTokenListResponse(BaseModel):
    tokens: list[ApiTokenRow]
    vs_customer_id: int


def _mask(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "****" + key[-4:]


@router.get(
    "/List/{customerId}",
    response_model=ApiTokenListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_api_tokens(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ApiTokenListResponse:
    """Return the customer's API key (masked) as a read-only token list."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing API tokens vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    return ApiTokenListResponse(
        tokens=[ApiTokenRow(token_masked=_mask(customer.api_key), enabled=customer.active)],
        vs_customer_id=customerId,
    )
