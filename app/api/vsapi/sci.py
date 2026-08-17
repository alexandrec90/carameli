from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.sci import (
    PostSciByZipCodeRequest,
    PrecallRequest,
    PrecallResponse,
    SciResponse,
    UpdateSciUserOptionRequest,
)
from app.services import customer_service, extension_service, phone_line_service, sci_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sci"])


@router.post(
    "/Precall/Add",
    response_model=PrecallResponse,
    responses={
        404: {"description": "Customer or extension not found"},
        409: {"description": "No matching customer caller ID"},
    },
)
async def prepare_sci_call(
    body: PrecallRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PrecallResponse:
    """Select and persist the caller ID for one imminent VanillaSoft call."""
    enforce_customer_scope(auth, body.vs_customer_id)
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    extension = await extension_service.get_by_number(session, customer.id, body.from_extension)
    if not extension:
        raise HTTPException(status_code=404, detail="Extension not found")
    lines = await phone_line_service.get_all_for_customer(session, customer.id)
    try:
        preparation = await sci_service.prepare_call(
            session,
            customer_id=customer.id,
            extension=extension,
            contact_id=body.contact_id,
            destination_number=body.destination_number,
            candidate_area_codes=body.area_codes,
            lines=lines,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return PrecallResponse(
        success=True,
        selected_caller_id=preparation.selected_caller_id,
        expires_at=preparation.expires_at.isoformat(),
    )


@router.post(
    "/PostSCIbyZipCode",
    response_model=SciResponse,
    responses={400: {"description": "Invalid request body"}, 404: {"description": "Not found"}},
)
async def post_sci_by_zip_code(
    body: PostSciByZipCodeRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SciResponse:
    """Store a zip-code routing rule for Selective Call Interception."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "SCI zip rule vs_customer_id=%s ext=%s zip=%s enabled=%s",
        body.vs_customer_id,
        body.extension_number,
        body.zip_code,
        body.enabled,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    ext = await extension_service.get_by_number(session, customer.id, body.extension_number)
    if not ext:
        logger.warning(
            "Extension not found vs_customer_id=%s ext=%s",
            body.vs_customer_id,
            body.extension_number,
        )
        raise HTTPException(status_code=404, detail="Extension not found")

    if len(body.zip_code) == 3:
        logger.warning(
            "SCI zip_code provided as 3-digit area prefix vs_customer_id=%s ext=%s zip_code=%s",
            body.vs_customer_id,
            body.extension_number,
            body.zip_code,
        )

    await sci_service.upsert(
        session,
        customer_id=customer.id,
        extension_id=ext.id,
        zip_code=body.zip_code,
        enabled=body.enabled,
    )
    return SciResponse(success=True)


@router.post(
    "/UpdateSCIUserOption",
    response_model=SciResponse,
    responses={400: {"description": "Invalid request body"}, 404: {"description": "Not found"}},
)
async def update_sci_user_option(
    body: UpdateSciUserOptionRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> SciResponse:
    """Enable or disable all SCI rules for an extension."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "SCI user option vs_customer_id=%s ext=%s enabled=%s",
        body.vs_customer_id,
        body.extension_number,
        body.enabled,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    ext = await extension_service.get_by_number(session, customer.id, body.extension_number)
    if not ext:
        logger.warning(
            "Extension not found vs_customer_id=%s ext=%s",
            body.vs_customer_id,
            body.extension_number,
        )
        raise HTTPException(status_code=404, detail="Extension not found")

    await sci_service.update_extension_option(
        session,
        customer_id=customer.id,
        extension_id=ext.id,
        enabled=body.enabled,
    )
    return SciResponse(success=True)
