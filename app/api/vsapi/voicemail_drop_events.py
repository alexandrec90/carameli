from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.voicemail_drop_event import (
    VoicemailDropEventListResponse,
    VoicemailDropEventResponse,
)
from app.services import customer_service, voicemail_drop_event_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsMailboxDrop", tags=["mailbox-drop"])


@router.get(
    "/List/{customerId}",
    response_model=VoicemailDropEventListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_voicemail_drop_events(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> VoicemailDropEventListResponse:
    """List a customer's voicemail drop history, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing voicemail drop events vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    events = await voicemail_drop_event_service.list_for_customer(session, customer.id)
    return VoicemailDropEventListResponse(
        events=[VoicemailDropEventResponse.model_validate(e) for e in events],
        vs_customer_id=customerId,
    )
