from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.parking_lot import (
    AddParkingLotRequest,
    ParkingLotListResponse,
    ParkingLotResponse,
)
from app.services import customer_service, parking_lot_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsParking", tags=["parking-lots"])


@router.get(
    "/List/{customerId}",
    response_model=ParkingLotListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_parking_lots(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ParkingLotListResponse:
    """List a customer's call-parking extensions, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing parking lots vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    lots = await parking_lot_service.list_for_customer(session, customer.id)
    return ParkingLotListResponse(
        parking_lots=[ParkingLotResponse.model_validate(lot) for lot in lots],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=ParkingLotResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_parking_lot(
    body: AddParkingLotRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ParkingLotResponse:
    """Create a call-parking extension (config only; live slot state is deferred)."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding parking lot vs_customer_id=%s extension=%s",
        body.vs_customer_id,
        body.extension,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    lot = await parking_lot_service.create(
        session,
        customer_id=customer.id,
        description=body.description,
        extension=body.extension,
        ring_back_time_limit=body.ring_back_time_limit,
    )
    logger.info("Parking lot created id=%s vs_customer_id=%s", lot.id, body.vs_customer_id)
    return ParkingLotResponse.model_validate(lot)


@router.put(
    "/Deactivate/{customerId}/{lotId}",
    response_model=ParkingLotResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_parking_lot(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    lotId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ParkingLotResponse:
    """Soft-delete a customer's call-parking extension."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating parking lot vs_customer_id=%s lot_id=%s",
        customerId,
        lotId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    lot = await parking_lot_service.get_for_customer(session, lotId, customer.id)
    if not lot:
        logger.warning("Parking lot not found vs_customer_id=%s lot_id=%s", customerId, lotId)
        raise HTTPException(status_code=404, detail="Parking lot not found")
    lot = await parking_lot_service.deactivate(session, lot)
    return ParkingLotResponse.model_validate(lot)
