from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.exemption_code import (
    AddExemptionCodeRequest,
    ExemptionCodeListResponse,
    ExemptionCodeResponse,
)
from app.services import customer_service, exemption_code_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsExemptionCode", tags=["exemption-codes"])


@router.get(
    "/List/{customerId}",
    response_model=ExemptionCodeListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_exemption_codes(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExemptionCodeListResponse:
    """List a customer's exemption codes, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing exemption codes vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    codes = await exemption_code_service.list_for_customer(session, customer.id)
    return ExemptionCodeListResponse(
        exemption_codes=[ExemptionCodeResponse.model_validate(c) for c in codes],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=ExemptionCodeResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_exemption_code(
    body: AddExemptionCodeRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExemptionCodeResponse:
    """Create an exemption code that bypasses call restrictions."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding exemption code vs_customer_id=%s code=%s",
        body.vs_customer_id,
        body.code,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    ec = await exemption_code_service.create(
        session,
        customer_id=customer.id,
        description=body.description,
        code=body.code,
        call_restrictions=body.call_restrictions,
    )
    logger.info("Exemption code created id=%s vs_customer_id=%s", ec.id, body.vs_customer_id)
    return ExemptionCodeResponse.model_validate(ec)


@router.put(
    "/Deactivate/{customerId}/{exemptionId}",
    response_model=ExemptionCodeResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_exemption_code(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    exemptionId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExemptionCodeResponse:
    """Soft-delete an exemption code."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating exemption code vs_customer_id=%s exemption_id=%s",
        customerId,
        exemptionId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    ec = await exemption_code_service.get_for_customer(session, exemptionId, customer.id)
    if not ec:
        logger.warning(
            "Exemption code not found vs_customer_id=%s exemption_id=%s",
            customerId,
            exemptionId,
        )
        raise HTTPException(status_code=404, detail="Exemption code not found")
    ec = await exemption_code_service.deactivate(session, ec)
    return ExemptionCodeResponse.model_validate(ec)
