from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.base.exceptions import TwilioRestException

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.phone_line import (
    AddPhoneLineRequest,
    DeactivatePhoneLineRequest,
    PhoneLineCountResponse,
    PhoneLineResponse,
    UpdateRecordingRequest,
)
from app.services.twilio_provider import TwilioProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/PhoneLine", tags=["phone-lines"])


@router.post("/Add", status_code=201, response_model=PhoneLineResponse)
async def add_phone_line(
    body: AddPhoneLineRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PhoneLineResponse:
    """Purchase a new DID from Twilio and register it for the customer."""
    logger.info("Adding phone line vs_customer_id=%s area_code=%s number=%s", body.vs_customer_id, body.area_code, body.phone_number)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    provider: TwilioProvider = request.app.state.twilio
    try:
        result = await provider.purchase_did(
            area_code=body.area_code,
            phone_number=body.phone_number,
        )
    except TwilioRestException as exc:
        logger.error("Twilio error purchasing DID vs_customer_id=%s: %s", body.vs_customer_id, exc.msg)
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")
    except ValueError as exc:
        logger.warning("Invalid DID request vs_customer_id=%s: %s", body.vs_customer_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))

    line_repo = PhoneLineRepo(session)
    line = await line_repo.create(
        customer_id=customer.id,
        phone_number=result["phone_number"],
        twilio_sid=result["sid"],
    )
    logger.info("Phone line added number=%s sid=%s vs_customer_id=%s", line.phone_number, line.twilio_sid, body.vs_customer_id)
    return PhoneLineResponse.model_validate(line)


@router.get("/Get/{customerId}/{phoneNumber:path}", response_model=PhoneLineResponse)
async def get_phone_line(
    customerId: int,
    phoneNumber: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PhoneLineResponse:
    """Get info for a specific DID."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, phoneNumber)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")
    return PhoneLineResponse.model_validate(line)


@router.get("/GetCount/{customerId}", response_model=PhoneLineCountResponse)
async def get_phone_line_count(
    customerId: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PhoneLineCountResponse:
    """Return the count of active DIDs for a customer."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    count = await line_repo.count_for_customer(customer.id)
    return PhoneLineCountResponse(count=count, vs_customer_id=customerId)


@router.put("/Deactivate", response_model=PhoneLineResponse)
async def deactivate_phone_line(
    body: DeactivatePhoneLineRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PhoneLineResponse:
    """Release a DID from Twilio and mark it inactive."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    provider: TwilioProvider = request.app.state.twilio
    try:
        await provider.release_did(line.twilio_sid)
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")

    line = await line_repo.deactivate(line)
    return PhoneLineResponse.model_validate(line)


@router.put("/UpdateCallRecording", response_model=PhoneLineResponse)
async def update_call_recording(
    body: UpdateRecordingRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PhoneLineResponse:
    """Toggle call recording for a DID."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    provider: TwilioProvider = request.app.state.twilio
    try:
        await provider.update_recording(line.twilio_sid, body.enabled)
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")

    line = await line_repo.update_recording_enabled(line, body.enabled)
    return PhoneLineResponse.model_validate(line)
