from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.multicast_group import (
    AddMulticastGroupRequest,
    MulticastGroupListResponse,
    MulticastGroupResponse,
)
from app.services import customer_service, multicast_group_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsMulticast", tags=["multicast-groups"])


@router.get(
    "/List/{customerId}",
    response_model=MulticastGroupListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_multicast_groups(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> MulticastGroupListResponse:
    """List a customer's multi-cast intercom extensions, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing multicast groups vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    groups = await multicast_group_service.list_for_customer(session, customer.id)
    return MulticastGroupListResponse(
        multicast_groups=[MulticastGroupResponse.model_validate(g) for g in groups],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=MulticastGroupResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_multicast_group(
    body: AddMulticastGroupRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> MulticastGroupResponse:
    """Create a multi-cast intercom that broadcasts from one source to subscribers."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding multicast group vs_customer_id=%s extension=%s",
        body.vs_customer_id,
        body.extension,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    group = await multicast_group_service.create(
        session,
        customer_id=customer.id,
        extension=body.extension,
        description=body.description,
        extensions=body.extensions,
        users=body.users,
    )
    logger.info("Multicast group created id=%s vs_customer_id=%s", group.id, body.vs_customer_id)
    return MulticastGroupResponse.model_validate(group)


@router.put(
    "/Deactivate/{customerId}/{groupId}",
    response_model=MulticastGroupResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_multicast_group(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    groupId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> MulticastGroupResponse:
    """Soft-delete a customer's multi-cast intercom extension."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating multicast group vs_customer_id=%s group_id=%s",
        customerId,
        groupId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    group = await multicast_group_service.get_for_customer(session, groupId, customer.id)
    if not group:
        logger.warning(
            "Multicast group not found vs_customer_id=%s group_id=%s", customerId, groupId
        )
        raise HTTPException(status_code=404, detail="Multicast group not found")
    group = await multicast_group_service.deactivate(session, group)
    return MulticastGroupResponse.model_validate(group)
