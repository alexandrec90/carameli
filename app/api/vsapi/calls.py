from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth_context
from app.core.database import get_session
from app.schemas.call_event import CallRecordingResponse
from app.services import call_event_service, customer_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/VsCall", tags=["calls"])


@router.get(
    "/Recording/{call_sid}",
    response_model=CallRecordingResponse,
    responses={404: {"description": "Not found"}},
)
async def get_recording(
    call_sid: Annotated[str, Path(pattern=r"^[^\x00]+$")],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CallRecordingResponse:
    """Retrieve recording URL and duration for a completed call by CallSid."""
    logger.info("Recording lookup call_sid=%s", call_sid)
    event = await call_event_service.get_by_call_sid(session, call_sid)
    if not event:
        logger.warning("Call not found call_sid=%s", call_sid)
        raise HTTPException(status_code=404, detail="Call not found")
    # Enforce customer scoping — non-admin tokens can only access their own recordings.
    if not auth.is_admin and event.customer_id:
        customer = await customer_service.get_by_id(session, event.customer_id)
        if not customer or customer.vs_customer_id != auth.vs_customer_id:
            raise HTTPException(status_code=403, detail="Forbidden for this customer")
    if not event.recording_url:
        raise HTTPException(status_code=404, detail="No recording for this call")
    return CallRecordingResponse(
        call_sid=event.call_sid,
        recording_url=event.recording_url,
        duration_seconds=event.duration_seconds,
    )
