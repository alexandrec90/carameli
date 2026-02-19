from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.did_pointer_repo import DidPointerRepo
from app.repositories.extension_repo import ExtensionRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.pointer import AddPointerRequest, DeletePointerRequest, PointerResponse

router = APIRouter(tags=["pointers"])


@router.post("/AddPointerToExtension", response_model=PointerResponse)
async def add_pointer(
    body: AddPointerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PointerResponse:
    """Map a DID to a SIP extension for call forwarding."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, body.extension_number)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    pointer_repo = DidPointerRepo(session)
    await pointer_repo.create(phone_line_id=line.id, extension_id=ext.id)
    return PointerResponse(success=True)


@router.delete("/DeletePointerToExtension", response_model=PointerResponse)
async def delete_pointer(
    body: DeletePointerRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> PointerResponse:
    """Remove the DID→extension mapping."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    line_repo = PhoneLineRepo(session)
    line = await line_repo.get_by_number(customer.id, body.phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, body.extension_number)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    pointer_repo = DidPointerRepo(session)
    pointer = await pointer_repo.get(phone_line_id=line.id, extension_id=ext.id)
    if not pointer:
        raise HTTPException(status_code=404, detail="Pointer not found")

    await pointer_repo.delete(pointer)
    return PointerResponse(success=True)
