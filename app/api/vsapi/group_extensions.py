from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.group_extension import (
    AddGroupExtensionRequest,
    GroupExtensionListResponse,
    GroupExtensionResponse,
)
from app.services import customer_service, group_extension_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsGroupExtension", tags=["group-extensions"])


@router.get(
    "/List/{customerId}",
    response_model=GroupExtensionListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_group_extensions(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> GroupExtensionListResponse:
    """List a customer's group extensions, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing group extensions vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    groups = await group_extension_service.list_for_customer(session, customer.id)
    return GroupExtensionListResponse(
        group_extensions=[GroupExtensionResponse.model_validate(g) for g in groups],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=GroupExtensionResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_group_extension(
    body: AddGroupExtensionRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> GroupExtensionResponse:
    """Create a group extension that rings a set of subscribed extensions."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding group extension vs_customer_id=%s number=%s",
        body.vs_customer_id,
        body.number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    group = await group_extension_service.create(
        session,
        customer_id=customer.id,
        description=body.description,
        number=body.number,
        subscribed_extensions=body.subscribed_extensions,
    )
    logger.info("Group extension created id=%s vs_customer_id=%s", group.id, body.vs_customer_id)
    return GroupExtensionResponse.model_validate(group)


@router.put(
    "/Deactivate/{customerId}/{groupId}",
    response_model=GroupExtensionResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_group_extension(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    groupId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> GroupExtensionResponse:
    """Soft-delete a customer's group extension."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating group extension vs_customer_id=%s group_id=%s",
        customerId,
        groupId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    group = await group_extension_service.get_for_customer(session, groupId, customer.id)
    if not group:
        logger.warning(
            "Group extension not found vs_customer_id=%s group_id=%s", customerId, groupId
        )
        raise HTTPException(status_code=404, detail="Group extension not found")
    group = await group_extension_service.deactivate(session, group)
    return GroupExtensionResponse.model_validate(group)
