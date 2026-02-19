from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.extension_repo import ExtensionRepo
from app.repositories.sci_rule_repo import SciRuleRepo
from app.schemas.sci import PostSciByZipCodeRequest, SciResponse, UpdateSciUserOptionRequest

router = APIRouter(tags=["sci"])


@router.post("/PostSCIbyZipCode", response_model=SciResponse)
async def post_sci_by_zip_code(
    body: PostSciByZipCodeRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> SciResponse:
    """Store a zip-code routing rule for Selective Call Interception."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, body.extension_number)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    sci_repo = SciRuleRepo(session)
    await sci_repo.upsert(
        customer_id=customer.id,
        extension_id=ext.id,
        zip_code=body.zip_code,
        enabled=body.enabled,
    )
    return SciResponse(success=True)


@router.post("/UpdateSCIUserOption", response_model=SciResponse)
async def update_sci_user_option(
    body: UpdateSciUserOptionRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> SciResponse:
    """Enable or disable all SCI rules for an extension."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_number(customer.id, body.extension_number)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")

    sci_repo = SciRuleRepo(session)
    await sci_repo.update_extension_option(
        customer_id=customer.id,
        extension_id=ext.id,
        enabled=body.enabled,
    )
    return SciResponse(success=True)
