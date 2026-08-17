from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.core.phone import normalize_phone_number
from app.schemas.branch import BranchAssignmentRequest, BranchAssignmentResponse
from app.services import customer_service, extension_service, phone_line_service

router = APIRouter(prefix="/Branch", tags=["branches"])


@router.put(
    "/Assign",
    response_model=BranchAssignmentResponse,
    responses={404: {"description": "Customer or target not found"}},
)
async def assign_branch(
    body: BranchAssignmentRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> BranchAssignmentResponse:
    """Attach an opaque VanillaSoft branch id to a DID or extension.

    Branches are CRM organization metadata, not carrier resources, so this does
    not leak the legacy provider's branch concept into the provider Protocols.
    """
    enforce_customer_scope(auth, body.vs_customer_id)
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    extension = await extension_service.get_by_number(session, customer.id, body.target)
    if extension:
        await extension_service.assign_branch(session, extension, body.branch_id)
        return BranchAssignmentResponse(
            success=True,
            target=body.target,
            target_type="extension",
            branch_id=body.branch_id,
        )

    phone_number = str(normalize_phone_number(body.target))
    line = await phone_line_service.get_by_number(session, customer.id, phone_number)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line or extension not found")
    await phone_line_service.assign_branch(session, line, body.branch_id)
    return BranchAssignmentResponse(
        success=True,
        target=line.phone_number,
        target_type="phone_line",
        branch_id=body.branch_id,
    )
