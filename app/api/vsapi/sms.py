from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.config import settings
from app.core.database import get_session
from app.core.limiter import limiter
from app.schemas.sms import (
    SendSmsRequest,
    SmsEnableDisableResponse,
    SmsMessageListResponse,
    SmsMessageResponse,
    SmsStatusResponse,
)
from app.services import customer_service, phone_line_service, sms_message_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsMessaging/Sms", tags=["sms"])


@router.put(
    "/Enable/{customerId}/{smsPhoneNumber:path}",
    response_model=SmsEnableDisableResponse,
    responses={404: {"description": "Not found"}, 502: {"description": "Provider error"}},
)
async def enable_sms(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    smsPhoneNumber: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SmsEnableDisableResponse:
    """Enable SMS on a DID through the active carrier provider."""
    enforce_customer_scope(auth, customerId)
    logger.info("Enabling SMS vs_customer_id=%s number=%s", customerId, smsPhoneNumber)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    line = await phone_line_service.get_by_number(session, customer.id, smsPhoneNumber)
    if not line:
        logger.warning(
            "Phone line not found vs_customer_id=%s number=%s",
            customerId,
            smsPhoneNumber,
        )
        raise HTTPException(status_code=404, detail="Phone line not found")

    carrier = request.app.state.carrier
    try:
        await carrier.enable_sms(line.provider_sid)
    except Exception as exc:
        logger.error("Provider error enabling SMS number=%s: %s", smsPhoneNumber, exc)
        raise HTTPException(status_code=502, detail="Provider error enabling SMS") from None

    line = await phone_line_service.update_sms_enabled(session, line, True)
    logger.info("SMS enabled number=%s", smsPhoneNumber)
    return SmsEnableDisableResponse(success=True, phone_number=smsPhoneNumber, sms_enabled=True)


@router.put(
    "/Disable/{customerId}/{smsPhoneNumber:path}",
    response_model=SmsEnableDisableResponse,
    responses={404: {"description": "Not found"}, 502: {"description": "Provider error"}},
)
async def disable_sms(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    smsPhoneNumber: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SmsEnableDisableResponse:
    """Disable SMS on a DID through the active carrier provider."""
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line = await phone_line_service.get_by_number(session, customer.id, smsPhoneNumber)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    carrier = request.app.state.carrier
    try:
        await carrier.disable_sms(line.provider_sid)
    except Exception:
        raise HTTPException(status_code=502, detail="Provider error disabling SMS") from None

    line = await phone_line_service.update_sms_enabled(session, line, False)
    return SmsEnableDisableResponse(success=True, phone_number=smsPhoneNumber, sms_enabled=False)


@router.post(
    "/Send/{customerId}",
    response_model=SmsStatusResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
        502: {"description": "Provider error"},
    },
)
@limiter.limit(settings.rate_limit_sms)
async def send_sms(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    body: SendSmsRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SmsStatusResponse:
    """Send an SMS via the active carrier provider."""
    enforce_customer_scope(auth, customerId)
    # Mirror CmvSmsProvider.cs: international SMS (non-US country code) is not supported.
    if not body.to_number.startswith("+1"):
        logger.warning("International SMS rejected to_number=%s", body.to_number)
        raise HTTPException(status_code=400, detail="International SMS is not supported")
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    carrier = request.app.state.carrier
    try:
        result = await carrier.send_sms(
            from_=body.from_number,
            to=body.to_number,
            body=body.body,
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Provider error sending SMS") from None

    message_sid: str | None = result.get("sid")

    # Resolve phone_line_id for the from_number if it belongs to this customer.
    line = await phone_line_service.get_by_number(session, customer.id, body.from_number)
    await sms_message_service.create_outbound(
        session,
        customer_id=customer.id,
        phone_line_id=line.id if line else None,
        message_sid=message_sid,
        from_number=body.from_number,
        to_number=body.to_number,
        body=body.body,
    )
    logger.info(
        "Outbound SMS persisted vs_customer_id=%s from=%s to=%s sid=%s",
        customerId,
        body.from_number,
        body.to_number,
        message_sid,
    )

    return SmsStatusResponse(success=True, message_sid=message_sid)


@router.get(
    "/List/{customerId}",
    response_model=SmsMessageListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_sms_messages(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    start: Annotated[datetime | None, Query()] = None,
    end: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> SmsMessageListResponse:
    """List a customer's SMS messages, newest first, with an optional created_at date range."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing SMS messages vs_customer_id=%s start=%s end=%s", customerId, start, end)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    messages = await sms_message_service.list_for_customer(session, customer.id, start, end, limit)
    return SmsMessageListResponse(
        messages=[SmsMessageResponse.model_validate(m) for m in messages],
        vs_customer_id=customerId,
    )
