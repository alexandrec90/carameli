from __future__ import annotations

import logging
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.extension_repo import ExtensionRepo
from app.schemas.extension import (
    AddExtensionRequest,
    AvailableExtensionsResponse,
    ExtensionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsExtension", tags=["extensions"])


@router.post("/Add", status_code=201, response_model=ExtensionResponse)
async def add_extension(
    body: AddExtensionRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExtensionResponse:
    """Create a SIP extension record with locally-managed credentials."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding extension vs_customer_id=%s ext=%s",
        body.vs_customer_id,
        body.extension_number,
    )
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    existing = await ext_repo.get_by_number(customer.id, body.extension_number)
    if existing:
        logger.warning(
            "Extension already exists vs_customer_id=%s ext=%s",
            body.vs_customer_id,
            body.extension_number,
        )
        raise HTTPException(status_code=409, detail="Extension already exists")

    sip_username = f"ext{body.extension_number}_{str(customer.id)[:8]}"
    _ = body.password or secrets.token_urlsafe(
        24
    )  # password stored by caller; not persisted here

    ext = await ext_repo.create(
        customer_id=customer.id,
        extension_number=body.extension_number,
        sip_username=sip_username,
        sip_credential_sid=None,
        sip_domain_sid=None,
    )
    logger.info("Extension created id=%s sip_username=%s", ext.id, sip_username)
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
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AvailableExtensionsResponse:
    """List free extension numbers in the given range for this customer."""
    enforce_customer_scope(auth, customerId)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    used = await ext_repo.get_used_numbers(customer.id)
    available = [str(n) for n in range(startExt, endExt + 1) if str(n) not in used]
    return AvailableExtensionsResponse(available=available, vs_customer_id=customerId)


@router.put("/Deactivate/{customerId}/{extension}", response_model=ExtensionResponse)
async def deactivate_extension(
    customerId: int,
    extension: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExtensionResponse:
    """Mark the extension inactive."""
    enforce_customer_scope(auth, customerId)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, extension)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    ext = await ext_repo.deactivate(ext)
    return ExtensionResponse.model_validate(ext)
