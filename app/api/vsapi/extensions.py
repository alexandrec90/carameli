from __future__ import annotations

import logging
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.extension import (
    AddExtensionRequest,
    AvailableExtensionsResponse,
    ExtensionResponse,
)
from app.services import customer_service, extension_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsExtension", tags=["extensions"])


@router.post(
    "/Add",
    status_code=201,
    response_model=ExtensionResponse,
    responses={
        404: {"description": "Customer not found"},
        409: {"description": "Extension already exists"},
    },
)
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
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    existing = await extension_service.get_by_number(session, customer.id, body.extension_number)
    if existing:
        logger.warning(
            "Extension already exists vs_customer_id=%s ext=%s",
            body.vs_customer_id,
            body.extension_number,
        )
        raise HTTPException(status_code=409, detail="Extension already exists")

    sip_username = f"ext{body.extension_number}_{str(customer.id)[:8]}"
    _ = body.password or secrets.token_urlsafe(24)  # password stored by caller; not persisted here

    ext = await extension_service.create(
        session,
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
    responses={404: {"description": "Customer not found"}},
)
async def get_available_extensions(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    customerId: int = Path(ge=1, le=2147483647),
    startExt: int = Path(),
    endExt: int = Path(),
) -> AvailableExtensionsResponse:
    """List free extension numbers in the given range for this customer."""
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    used = await extension_service.get_used_numbers(session, customer.id)
    available = [str(n) for n in range(startExt, endExt + 1) if str(n) not in used]
    return AvailableExtensionsResponse(available=available, vs_customer_id=customerId)


@router.put(
    "/Deactivate/{customerId}/{extension}",
    response_model=ExtensionResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_extension(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    customerId: int = Path(ge=1, le=2147483647),
    extension: str = Path(),
) -> ExtensionResponse:
    """Mark the extension inactive."""
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext = await extension_service.get_by_number(session, customer.id, extension)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    ext = await extension_service.deactivate(session, ext)
    return ExtensionResponse.model_validate(ext)
