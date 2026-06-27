from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.call_queue import (
    AddCallQueueRequest,
    CallQueueListResponse,
    CallQueueResponse,
)
from app.services import call_queue_service, customer_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsCallQueue", tags=["call-queues"])


@router.get(
    "/List/{customerId}",
    response_model=CallQueueListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_call_queues(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CallQueueListResponse:
    """List a customer's call queues, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing call queues vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    queues = await call_queue_service.list_for_customer(session, customer.id)
    return CallQueueListResponse(
        call_queues=[CallQueueResponse.model_validate(q) for q in queues],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=CallQueueResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_call_queue(
    body: AddCallQueueRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CallQueueResponse:
    """Create a call queue configuration."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding call queue vs_customer_id=%s name=%s strategy=%s",
        body.vs_customer_id,
        body.name,
        body.strategy,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    queue = await call_queue_service.create(
        session,
        customer_id=customer.id,
        name=body.name,
        strategy=body.strategy,
    )
    logger.info("Call queue created id=%s vs_customer_id=%s", queue.id, body.vs_customer_id)
    return CallQueueResponse.model_validate(queue)


@router.put(
    "/Deactivate/{customerId}/{queueId}",
    response_model=CallQueueResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_call_queue(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    queueId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CallQueueResponse:
    """Soft-delete a customer's call queue."""
    enforce_customer_scope(auth, customerId)
    logger.info("Deactivating call queue vs_customer_id=%s queue_id=%s", customerId, queueId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    queue = await call_queue_service.get_for_customer(session, queueId, customer.id)
    if not queue:
        logger.warning("Call queue not found vs_customer_id=%s queue_id=%s", customerId, queueId)
        raise HTTPException(status_code=404, detail="Call queue not found")
    queue = await call_queue_service.deactivate(session, queue)
    return CallQueueResponse.model_validate(queue)
