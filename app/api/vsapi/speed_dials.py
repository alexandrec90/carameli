from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.speed_dial import (
    AddSpeedDialRequest,
    SpeedDialListResponse,
    SpeedDialResponse,
)
from app.services import customer_service, speed_dial_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsSpeedDial", tags=["speed-dials"])


@router.get(
    "/List/{customerId}",
    response_model=SpeedDialListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_speed_dials(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SpeedDialListResponse:
    """List a customer's speed dials, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing speed dials vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    dials = await speed_dial_service.list_for_customer(session, customer.id)
    return SpeedDialListResponse(
        speed_dials=[SpeedDialResponse.model_validate(d) for d in dials],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=SpeedDialResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_speed_dial(
    body: AddSpeedDialRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SpeedDialResponse:
    """Create a speed-dial shortcut (*75+code → phone number)."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding speed dial vs_customer_id=%s code=%s phone_number=%s",
        body.vs_customer_id,
        body.code,
        body.phone_number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    sd = await speed_dial_service.create(
        session,
        customer_id=customer.id,
        code=body.code,
        phone_number=body.phone_number,
        description=body.description,
    )
    logger.info("Speed dial created id=%s vs_customer_id=%s", sd.id, body.vs_customer_id)
    return SpeedDialResponse.model_validate(sd)


@router.put(
    "/Deactivate/{customerId}/{dialId}",
    response_model=SpeedDialResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_speed_dial(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    dialId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SpeedDialResponse:
    """Soft-delete a speed dial."""
    enforce_customer_scope(auth, customerId)
    logger.info("Deactivating speed dial vs_customer_id=%s dial_id=%s", customerId, dialId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    sd = await speed_dial_service.get_for_customer(session, dialId, customer.id)
    if not sd:
        logger.warning("Speed dial not found vs_customer_id=%s dial_id=%s", customerId, dialId)
        raise HTTPException(status_code=404, detail="Speed dial not found")
    sd = await speed_dial_service.deactivate(session, sd)
    return SpeedDialResponse.model_validate(sd)
