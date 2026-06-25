from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.conference import (
    AddConferenceRequest,
    ConferenceListResponse,
    ConferenceResponse,
)
from app.services import conference_service, customer_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsConference", tags=["conferences"])


@router.get(
    "/List/{customerId}",
    response_model=ConferenceListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_conferences(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ConferenceListResponse:
    """List a customer's permanent telephone conferences, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing conferences vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    conferences = await conference_service.list_for_customer(session, customer.id)
    return ConferenceListResponse(
        conferences=[ConferenceResponse.model_validate(c) for c in conferences],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=ConferenceResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_conference(
    body: AddConferenceRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ConferenceResponse:
    """Create a permanent telephone conference room."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding conference vs_customer_id=%s number=%s",
        body.vs_customer_id,
        body.number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    conference = await conference_service.create(
        session,
        customer_id=customer.id,
        number=body.number,
        description=body.description,
        max_participants=body.max_participants,
        recorded_calls=body.recorded_calls,
    )
    logger.info("Conference created id=%s vs_customer_id=%s", conference.id, body.vs_customer_id)
    return ConferenceResponse.model_validate(conference)


@router.put(
    "/Deactivate/{customerId}/{conferenceId}",
    response_model=ConferenceResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_conference(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    conferenceId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ConferenceResponse:
    """Soft-delete a customer's telephone conference."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating conference vs_customer_id=%s conference_id=%s",
        customerId,
        conferenceId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    conference = await conference_service.get_for_customer(session, conferenceId, customer.id)
    if not conference:
        logger.warning(
            "Conference not found vs_customer_id=%s conference_id=%s", customerId, conferenceId
        )
        raise HTTPException(status_code=404, detail="Conference not found")
    conference = await conference_service.deactivate(session, conference)
    return ConferenceResponse.model_validate(conference)
