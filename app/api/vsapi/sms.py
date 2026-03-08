from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.sms import SendSmsRequest, SmsEnableDisableResponse, SmsStatusResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsMessaging/Sms", tags=["sms"])


@router.put("/Enable/{customerId}/{smsPhoneNumber:path}", response_model=SmsEnableDisableResponse)
async def enable_sms(
    customerId: int,
    smsPhoneNumber: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SmsEnableDisableResponse:
    """Enable SMS on a DID by attaching the Twilio SMS webhook."""
    enforce_customer_scope(auth, customerId)
    logger.info("Enabling SMS vs_customer_id=%s number=%s", customerId, smsPhoneNumber)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, smsPhoneNumber)
    if not line:
        logger.warning("Phone line not found vs_customer_id=%s number=%s", customerId, smsPhoneNumber)
        raise HTTPException(status_code=404, detail="Phone line not found")

    carrier = request.app.state.carrier
    try:
        await carrier.enable_sms(line.twilio_sid)
    except Exception as exc:
        logger.error("Provider error enabling SMS number=%s: %s", smsPhoneNumber, exc)
        raise HTTPException(status_code=502, detail="Provider error enabling SMS")

    line = await line_repo.update_sms_enabled(line, True)
    logger.info("SMS enabled number=%s", smsPhoneNumber)
    return SmsEnableDisableResponse(
        success=True, phone_number=smsPhoneNumber, sms_enabled=True
    )


@router.put("/Disable/{customerId}/{smsPhoneNumber:path}", response_model=SmsEnableDisableResponse)
async def disable_sms(
    customerId: int,
    smsPhoneNumber: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SmsEnableDisableResponse:
    """Disable SMS on a DID by removing the Twilio SMS webhook."""
    enforce_customer_scope(auth, customerId)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, smsPhoneNumber)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    carrier = request.app.state.carrier
    try:
        await carrier.disable_sms(line.twilio_sid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Provider error disabling SMS")

    line = await line_repo.update_sms_enabled(line, False)
    return SmsEnableDisableResponse(
        success=True, phone_number=smsPhoneNumber, sms_enabled=False
    )


@router.post("/Send/{customerId}", response_model=SmsStatusResponse)
async def send_sms(
    customerId: int,
    body: SendSmsRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SmsStatusResponse:
    """Send an SMS via Twilio Messaging."""
    enforce_customer_scope(auth, customerId)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    carrier = request.app.state.carrier
    try:
        result = await carrier.send_sms(
            from_=body.from_number,
            to=body.to_number,
            body=body.body,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Provider error sending SMS")

    return SmsStatusResponse(success=True, message_sid=result["sid"])
