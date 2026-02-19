from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.base.exceptions import TwilioRestException

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.extension_repo import ExtensionRepo
from app.schemas.extension import (
    AddExtensionRequest,
    AvailableExtensionsResponse,
    ExtensionResponse,
)
from app.services.twilio_provider import TwilioProvider

router = APIRouter(prefix="/VsExtension", tags=["extensions"])


@router.post("/Add", status_code=201, response_model=ExtensionResponse)
async def add_extension(
    body: AddExtensionRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> ExtensionResponse:
    """Create a SIP credential for the extension."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    existing = await ext_repo.get_by_number(customer.id, body.extension_number)
    if existing:
        raise HTTPException(status_code=409, detail="Extension already exists")

    provider: TwilioProvider = request.app.state.twilio
    sip_username = f"ext{body.extension_number}_{str(customer.id)[:8]}"
    password = body.password or TwilioProvider.generate_sip_password()

    try:
        cred_list_sid = await provider.ensure_credential_list(str(customer.id))
        domain_sid = await provider.ensure_sip_domain(str(customer.id))
        cred_sid = await provider.create_sip_credential(
            cred_list_sid, sip_username, password
        )
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")

    ext = await ext_repo.create(
        customer_id=customer.id,
        extension_number=body.extension_number,
        sip_username=sip_username,
        sip_credential_sid=cred_sid,
        twilio_domain_sid=domain_sid,
    )
    return ExtensionResponse.model_validate(ext)


@router.get(
    "/GetAvailable/{customerId}/{startExt}/{endExt}",
    response_model=AvailableExtensionsResponse,
)
async def get_available_extensions(
    customerId: int,
    startExt: int,
    endExt: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> AvailableExtensionsResponse:
    """List free extension numbers in the given range for this customer."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    used = await ext_repo.get_used_numbers(customer.id)
    available = [
        str(n) for n in range(startExt, endExt + 1) if str(n) not in used
    ]
    return AvailableExtensionsResponse(available=available, vs_customer_id=customerId)


@router.put("/Deactivate/{customerId}/{extension}", response_model=ExtensionResponse)
async def deactivate_extension(
    customerId: int,
    extension: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> ExtensionResponse:
    """Delete the SIP credential and mark the extension inactive."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, extension)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    provider: TwilioProvider = request.app.state.twilio
    if ext.sip_credential_sid and ext.twilio_domain_sid:
        try:
            cred_list_sid = await provider.ensure_credential_list(str(customer.id))
            await provider.delete_sip_credential(
                cred_list_sid, ext.sip_credential_sid
            )
        except TwilioRestException as exc:
            raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")

    ext = await ext_repo.deactivate(ext)
    return ExtensionResponse.model_validate(ext)
