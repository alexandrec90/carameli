from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.intercom_group import (
    AddIntercomGroupRequest,
    IntercomGroupListResponse,
    IntercomGroupResponse,
)
from app.services import customer_service, intercom_group_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsIntercom", tags=["intercom-groups"])


@router.get(
    "/List/{customerId}",
    response_model=IntercomGroupListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_intercom_groups(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> IntercomGroupListResponse:
    """List a customer's intercom extensions, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing intercom groups vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    groups = await intercom_group_service.list_for_customer(session, customer.id)
    return IntercomGroupListResponse(
        intercom_groups=[IntercomGroupResponse.model_validate(g) for g in groups],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=IntercomGroupResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_intercom_group(
    body: AddIntercomGroupRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> IntercomGroupResponse:
    """Create an intercom extension whose subscribers receive calls on their speaker."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding intercom group vs_customer_id=%s number=%s",
        body.vs_customer_id,
        body.number,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    group = await intercom_group_service.create(
        session,
        customer_id=customer.id,
        number=body.number,
        description=body.description,
        subscriber_extensions=body.subscriber_extensions,
        bidirectional_audio=body.bidirectional_audio,
        expiry=body.expiry,
    )
    logger.info("Intercom group created id=%s vs_customer_id=%s", group.id, body.vs_customer_id)
    return IntercomGroupResponse.model_validate(group)


@router.put(
    "/Deactivate/{customerId}/{groupId}",
    response_model=IntercomGroupResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_intercom_group(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    groupId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> IntercomGroupResponse:
    """Soft-delete a customer's intercom extension."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating intercom group vs_customer_id=%s group_id=%s",
        customerId,
        groupId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    group = await intercom_group_service.get_for_customer(session, groupId, customer.id)
    if not group:
        logger.warning(
            "Intercom group not found vs_customer_id=%s group_id=%s", customerId, groupId
        )
        raise HTTPException(status_code=404, detail="Intercom group not found")
    group = await intercom_group_service.deactivate(session, group)
    return IntercomGroupResponse.model_validate(group)
