from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook_subscription import WebhookSubscription
from app.repositories.webhook_subscription_repo import WebhookSubscriptionRepo

logger = logging.getLogger(__name__)


async def list_for_customer(
    session: AsyncSession, customer_id: uuid.UUID
) -> list[WebhookSubscription]:
    return await WebhookSubscriptionRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, subscription_id: uuid.UUID, customer_id: uuid.UUID
) -> WebhookSubscription | None:
    return await WebhookSubscriptionRepo(session).get_for_customer(subscription_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    description: str,
    uri: str,
    events: list[str],
    enabled: bool = True,
) -> WebhookSubscription:
    return await WebhookSubscriptionRepo(session).create(
        customer_id=customer_id,
        description=description,
        uri=uri,
        events=events,
        enabled=enabled,
    )


async def deactivate(session: AsyncSession, sub: WebhookSubscription) -> WebhookSubscription:
    return await WebhookSubscriptionRepo(session).deactivate(sub)
