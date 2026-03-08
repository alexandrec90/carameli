from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/PhoneLine", tags=["phone-lines"])


@router.post("/Add", status_code=201, response_model=PhoneLineResponse)
async def add_phone_line(
    body: AddPhoneLineRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Purchase a new DID from Twilio and register it for the customer."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info("Adding phone line vs_customer_id=%s area_code=%s number=%s", body.vs_customer_id, body.area_code, body.phone_number)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    carrier = request.app.state.carrier
    try:
        if body.phone_number:
            result = await carrier.provision_number(body.phone_number)
        elif body.area_code:
            numbers = await carrier.search_numbers(body.area_code, 1)
            if not numbers:
                raise ValueError(f"No numbers available in area code {body.area_code}")
            result = await carrier.provision_number(numbers[0]["phone_number"])
        else:
            raise ValueError("Must specify area_code or phone_number")
    except Exception as exc:
        logger.error("Provider error purchasing DID vs_customer_id=%s: %s", body.vs_customer_id, exc)
        raise HTTPException(status_code=502, detail="Provider error purchasing DID")
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
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Get info for a specific DID."""
    enforce_customer_scope(auth, customerId)
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
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineCountResponse:
    """Return the count of active DIDs for a customer."""
    enforce_customer_scope(auth, customerId)
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
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Release a DID from Twilio and mark it inactive."""
    enforce_customer_scope(auth, body.vs_customer_id)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    carrier = request.app.state.carrier
    try:
        await carrier.release_number(line.twilio_sid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Provider error releasing DID")

    line = await line_repo.deactivate(line)
    return PhoneLineResponse.model_validate(line)


@router.put("/UpdateCallRecording", response_model=PhoneLineResponse)
async def update_call_recording(
    body: UpdateRecordingRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Toggle call recording preference for a DID (applied per-call by the engine)."""
    enforce_customer_scope(auth, body.vs_customer_id)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    line = await line_repo.update_recording_enabled(line, body.enabled)
    return PhoneLineResponse.model_validate(line)
