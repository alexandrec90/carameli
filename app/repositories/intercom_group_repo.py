from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intercom_group import IntercomGroup

logger = logging.getLogger(__name__)


class IntercomGroupRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        number: str,
        description: str,
        subscriber_extensions: list[str],
        bidirectional_audio: bool,
        expiry: str | None,
    ) -> IntercomGroup:
        group = IntercomGroup(
            customer_id=customer_id,
            number=number,
            description=description,
            subscriber_extensions=subscriber_extensions,
            bidirectional_audio=bidirectional_audio,
            expiry=expiry,
        )
        self.session.add(group)
        await self.session.commit()
        await self.session.refresh(group)
        return group

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[IntercomGroup]:
        result = await self.session.execute(
            select(IntercomGroup)
            .where(
                IntercomGroup.customer_id == customer_id,
                IntercomGroup.active.is_(True),
            )
            .order_by(IntercomGroup.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, group_id: uuid.UUID, customer_id: uuid.UUID
    ) -> IntercomGroup | None:
        result = await self.session.execute(
            select(IntercomGroup).where(
                IntercomGroup.id == group_id,
                IntercomGroup.customer_id == customer_id,
                IntercomGroup.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, group: IntercomGroup) -> IntercomGroup:
        group.active = False
        await self.session.commit()
        await self.session.refresh(group)
        return group
