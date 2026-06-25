from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook_subscription import WebhookSubscription

logger = logging.getLogger(__name__)


class WebhookSubscriptionRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        description: str,
        uri: str,
        events: list[str],
        enabled: bool = True,
    ) -> WebhookSubscription:
        sub = WebhookSubscription(
            customer_id=customer_id,
            description=description,
            uri=uri,
            events=events,
            enabled=enabled,
        )
        self.session.add(sub)
        await self.session.commit()
        await self.session.refresh(sub)
        return sub

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[WebhookSubscription]:
        result = await self.session.execute(
            select(WebhookSubscription)
            .where(
                WebhookSubscription.customer_id == customer_id,
                WebhookSubscription.active.is_(True),
            )
            .order_by(WebhookSubscription.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, subscription_id: uuid.UUID, customer_id: uuid.UUID
    ) -> WebhookSubscription | None:
        result = await self.session.execute(
            select(WebhookSubscription).where(
                WebhookSubscription.id == subscription_id,
                WebhookSubscription.customer_id == customer_id,
                WebhookSubscription.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, sub: WebhookSubscription) -> WebhookSubscription:
        sub.active = False
        await self.session.commit()
        await self.session.refresh(sub)
        return sub
