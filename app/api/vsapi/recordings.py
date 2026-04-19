from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.recording import RecordingExportResponse
from app.services import call_event_service, customer_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/CallRecordings", tags=["recordings"])


@router.get(
    "/Export/{customerId}/{call_sid}",
    response_model=RecordingExportResponse,
    responses={
        404: {"description": "Call or recording not found"},
    },
)
async def export_recording(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    call_sid: Annotated[str, Path(pattern=r"^[^\x00]+$")],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> RecordingExportResponse:
    """Return a download URL for a call recording scoped to the given customer.

    If the recording_url stored on the call event is already a presigned or
    direct URL it is returned as-is.  S3 presigned URL generation will be wired
    in when the S3 client is initialised (tracked separately).
    """
    enforce_customer_scope(auth, customerId)
    logger.info("Recording export request vs_customer_id=%s call_sid=%s", customerId, call_sid)

    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")

    event = await call_event_service.get_by_call_sid_for_customer(session, call_sid, customer.id)
    if not event:
        logger.warning(
            "Call not found or not owned by customer vs_customer_id=%s call_sid=%s",
            customerId,
            call_sid,
        )
        raise HTTPException(status_code=404, detail="Call not found")

    if not event.recording_url:
        logger.warning("No recording available vs_customer_id=%s call_sid=%s", customerId, call_sid)
        raise HTTPException(status_code=404, detail="No recording available")

    logger.info("Recording export url returned vs_customer_id=%s call_sid=%s", customerId, call_sid)
    return RecordingExportResponse(call_sid=event.call_sid, download_url=event.recording_url)
