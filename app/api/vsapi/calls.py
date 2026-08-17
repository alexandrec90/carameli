from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.config import settings
from app.core.database import get_session
from app.core.sip import agent_sip_uri
from app.schemas.call_event import (
    CallEventListResponse,
    CallEventResponse,
    CallRecordingResponse,
    CallSummaryResponse,
    CallSummaryRow,
)
from app.schemas.outbound_call import OutboundCallRequest, OutboundCallResponse
from app.services import (
    call_event_service,
    customer_service,
    extension_service,
    phone_line_service,
    recording_links,
    sci_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/VsCall", tags=["calls"])


@router.post(
    "/Initiate",
    response_model=OutboundCallResponse,
    status_code=200,
    responses={
        404: {"description": "Customer, phone line, or extension not found"},
        502: {"description": "Call engine error"},
    },
)
async def initiate_outbound_call(
    body: OutboundCallRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> OutboundCallResponse:
    """Originate an outbound call from a customer DID and bridge to an agent extension on answer."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "VsCall/Initiate vs_customer_id=%s from=%s destination=%s extension=%s",
        body.vs_customer_id,
        body.from_number,
        body.destination_number,
        body.extension,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    ext = await extension_service.get_by_number(session, customer.id, body.extension)
    if not ext:
        logger.warning(
            "Extension not found vs_customer_id=%s extension=%s",
            body.vs_customer_id,
            body.extension,
        )
        raise HTTPException(status_code=404, detail="Extension not found")

    from_number = body.from_number
    preparation = None
    if body.contact_id is not None:
        preparation = await sci_service.consume_prepared_call(
            session,
            customer_id=customer.id,
            extension=ext,
            contact_id=body.contact_id,
            destination_number=body.destination_number,
        )
        if not preparation:
            raise HTTPException(status_code=409, detail="SCI preparation missing or expired")
        from_number = preparation.selected_caller_id

    line = await phone_line_service.get_by_number(session, customer.id, from_number)
    if not line:
        logger.warning(
            "Phone line not found vs_customer_id=%s from=%s",
            body.vs_customer_id,
            from_number,
        )
        raise HTTPException(status_code=404, detail="Phone line not found")

    webhook_url = f"{settings.jambonz_webhook_base_url}/webhooks/jambonz/outbound-answered"

    engine = request.app.state.engine
    result: dict | None = None
    try:
        result = await engine.initiate_call(
            from_=from_number,
            to=body.destination_number,
            webhook_url=webhook_url,
            tag={"agent_sip_uri": agent_sip_uri(ext.sip_username, ext.sip_domain_sid)},
        )
        if preparation is not None:
            await sci_service.mark_prepared_call_consumed(session, preparation)
        await call_event_service.create_from_webhook(
            session,
            customer.id,
            {
                "CallSid": result["call_id"],
                "CallStatus": result["status"],
                "Direction": "outbound",
                "From": from_number,
                "To": body.destination_number,
                "Extension": body.extension,
            },
        )
    except Exception as exc:
        await session.rollback()
        if result and result.get("call_id"):
            try:
                await engine.hangup_call(result["call_id"])
            except Exception:
                logger.exception("Failed to compensate untracked outbound call")
        logger.error(
            "Call engine error initiating outbound call vs_customer_id=%s destination=%s: %s",
            body.vs_customer_id,
            body.destination_number,
            exc,
        )
        raise HTTPException(status_code=502, detail="Call engine error") from None

    logger.info(
        "Outbound call initiated call_sid=%s vs_customer_id=%s destination=%s",
        result.get("call_id"),
        body.vs_customer_id,
        body.destination_number,
    )
    return OutboundCallResponse(call_sid=result["call_id"], status=result["status"])


@router.get(
    "/List/{customerId}",
    response_model=CallEventListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_call_events(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    start: Annotated[datetime | None, Query()] = None,
    end: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> CallEventListResponse:
    """List a customer's call events, newest first, with an optional started_at date range."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Listing call events vs_customer_id=%s start=%s end=%s limit=%s",
        customerId,
        start,
        end,
        limit,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    events = await call_event_service.list_for_customer(session, customer.id, start, end, limit)
    return CallEventListResponse(
        events=[CallEventResponse.model_validate(e) for e in events],
        vs_customer_id=customerId,
    )


@router.get(
    "/Summary/{customerId}",
    response_model=CallSummaryResponse,
    responses={404: {"description": "Customer not found"}},
)
async def call_summary(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    group_by: Annotated[Literal["extension", "number"], Query()] = "extension",
    start: Annotated[datetime | None, Query()] = None,
    end: Annotated[datetime | None, Query()] = None,
) -> CallSummaryResponse:
    """Aggregate a customer's call events into CDR summary statistics by extension or number."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "CDR summary vs_customer_id=%s group_by=%s start=%s end=%s",
        customerId,
        group_by,
        start,
        end,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    rows = await call_event_service.summarize_for_customer(
        session, customer.id, group_by, start, end
    )
    return CallSummaryResponse(
        summary=[CallSummaryRow.model_validate(r) for r in rows],
        group_by=group_by,
        vs_customer_id=customerId,
    )


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
        recording_url=recording_links.public_recording_url(event.call_sid),
        duration_seconds=event.duration_seconds,
    )
