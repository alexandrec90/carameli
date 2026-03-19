from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.pointer import AddPointerRequest, DeletePointerRequest, PointerResponse
from app.services import customer_service, extension_service, phone_line_service, pointer_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pointers"])


@router.post(
    "/AddPointerToExtension",
    response_model=PointerResponse,
    responses={400: {"description": "Invalid request body"}, 404: {"description": "Not found"}},
)
async def add_pointer(
    body: AddPointerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PointerResponse:
    """Map a DID to a SIP extension for call forwarding."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding pointer vs_customer_id=%s number=%s ext=%s",
        body.vs_customer_id,
        body.phone_number,
        body.extension_number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    line = await phone_line_service.get_by_number(session, customer.id, body.phone_number)
    if not line:
        logger.warning("Phone line not found number=%s", body.phone_number)
        raise HTTPException(status_code=404, detail="Phone line not found")

    ext = await extension_service.get_by_number(session, customer.id, body.extension_number)
    if not ext:
        logger.warning("Extension not found ext=%s", body.extension_number)
        raise HTTPException(status_code=404, detail="Extension not found")

    await pointer_service.create(session, phone_line_id=line.id, extension_id=ext.id)
    logger.info("Pointer added number=%s -> ext=%s", body.phone_number, body.extension_number)
    return PointerResponse(success=True)


@router.delete(
    "/DeletePointerToExtension",
    response_model=PointerResponse,
    responses={400: {"description": "Invalid request body"}, 404: {"description": "Not found"}},
)
async def delete_pointer(
    body: DeletePointerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PointerResponse:
    """Remove the DID→extension mapping."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Deleting pointer vs_customer_id=%s number=%s ext=%s",
        body.vs_customer_id,
        body.phone_number,
        body.extension_number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    line = await phone_line_service.get_by_number(session, customer.id, body.phone_number)
    if not line:
        logger.warning("Phone line not found number=%s", body.phone_number)
        raise HTTPException(status_code=404, detail="Phone line not found")

    ext = await extension_service.get_by_number(session, customer.id, body.extension_number)
    if not ext:
        logger.warning("Extension not found ext=%s", body.extension_number)
        raise HTTPException(status_code=404, detail="Extension not found")

    pointer = await pointer_service.get(session, phone_line_id=line.id, extension_id=ext.id)
    if not pointer:
        logger.warning(
            "Pointer not found number=%s ext=%s",
            body.phone_number,
            body.extension_number,
        )
        raise HTTPException(status_code=404, detail="Pointer not found")

    await pointer_service.delete(session, pointer)
    logger.info("Pointer deleted number=%s -> ext=%s", body.phone_number, body.extension_number)
    return PointerResponse(success=True)
