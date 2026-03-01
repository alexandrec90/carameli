from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.did_pointer_repo import DidPointerRepo
from app.repositories.extension_repo import ExtensionRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.pointer import AddPointerRequest, DeletePointerRequest, PointerResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pointers"])


@router.post("/AddPointerToExtension", response_model=PointerResponse)
async def add_pointer(
    body: AddPointerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PointerResponse:
    """Map a DID to a SIP extension for call forwarding."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info("Adding pointer vs_customer_id=%s number=%s ext=%s", body.vs_customer_id, body.phone_number, body.extension_number)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        logger.warning("Phone line not found number=%s", body.phone_number)
        raise HTTPException(status_code=404, detail="Phone line not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, body.extension_number)
    if not ext:
        logger.warning("Extension not found ext=%s", body.extension_number)
        raise HTTPException(status_code=404, detail="Extension not found")

    pointer_repo = DidPointerRepo(session)
    await pointer_repo.create(phone_line_id=line.id, extension_id=ext.id)
    logger.info("Pointer added number=%s -> ext=%s", body.phone_number, body.extension_number)
    return PointerResponse(success=True)


@router.delete("/DeletePointerToExtension", response_model=PointerResponse)
async def delete_pointer(
    body: DeletePointerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PointerResponse:
    """Remove the DID→extension mapping."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info("Deleting pointer vs_customer_id=%s number=%s ext=%s", body.vs_customer_id, body.phone_number, body.extension_number)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        logger.warning("Phone line not found number=%s", body.phone_number)
        raise HTTPException(status_code=404, detail="Phone line not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, body.extension_number)
    if not ext:
        logger.warning("Extension not found ext=%s", body.extension_number)
        raise HTTPException(status_code=404, detail="Extension not found")

    pointer_repo = DidPointerRepo(session)
    pointer = await pointer_repo.get(phone_line_id=line.id, extension_id=ext.id)
    if not pointer:
        logger.warning("Pointer not found number=%s ext=%s", body.phone_number, body.extension_number)
        raise HTTPException(status_code=404, detail="Pointer not found")

    await pointer_repo.delete(pointer)
    logger.info("Pointer deleted number=%s -> ext=%s", body.phone_number, body.extension_number)
    return PointerResponse(success=True)
