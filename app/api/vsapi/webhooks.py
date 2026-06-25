from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.webhook_subscription import (
    AddWebhookSubscriptionRequest,
    WebhookSubscriptionListResponse,
    WebhookSubscriptionResponse,
)
from app.services import customer_service, webhook_subscription_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsWebhook", tags=["webhooks"])


@router.get(
    "/List/{customerId}",
    response_model=WebhookSubscriptionListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_webhook_subscriptions(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> WebhookSubscriptionListResponse:
    """List a customer's webhook subscriptions, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing webhook subscriptions vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    subs = await webhook_subscription_service.list_for_customer(session, customer.id)
    return WebhookSubscriptionListResponse(
        subscriptions=[WebhookSubscriptionResponse.model_validate(s) for s in subs],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=WebhookSubscriptionResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_webhook_subscription(
    body: AddWebhookSubscriptionRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> WebhookSubscriptionResponse:
    """Create a webhook subscription that delivers the named events to a URI."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding webhook subscription vs_customer_id=%s uri=%s events=%s",
        body.vs_customer_id,
        body.uri,
        body.events,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    sub = await webhook_subscription_service.create(
        session,
        customer_id=customer.id,
        description=body.description,
        uri=body.uri,
        events=body.events,
        enabled=body.enabled,
    )
    logger.info("Webhook subscription created id=%s vs_customer_id=%s", sub.id, body.vs_customer_id)
    return WebhookSubscriptionResponse.model_validate(sub)


@router.put(
    "/Deactivate/{customerId}/{subscriptionId}",
    response_model=WebhookSubscriptionResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_webhook_subscription(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    subscriptionId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> WebhookSubscriptionResponse:
    """Soft-delete a customer's webhook subscription."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating webhook subscription vs_customer_id=%s subscription_id=%s",
        customerId,
        subscriptionId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    sub = await webhook_subscription_service.get_for_customer(session, subscriptionId, customer.id)
    if not sub:
        logger.warning(
            "Webhook subscription not found vs_customer_id=%s subscription_id=%s",
            customerId,
            subscriptionId,
        )
        raise HTTPException(status_code=404, detail="Webhook subscription not found")
    sub = await webhook_subscription_service.deactivate(session, sub)
    return WebhookSubscriptionResponse.model_validate(sub)
