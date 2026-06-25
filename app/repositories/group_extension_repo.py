from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group_extension import GroupExtension

logger = logging.getLogger(__name__)


class GroupExtensionRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        description: str,
        number: str,
        subscribed_extensions: list[str],
    ) -> GroupExtension:
        group = GroupExtension(
            customer_id=customer_id,
            description=description,
            number=number,
            subscribed_extensions=subscribed_extensions,
        )
        self.session.add(group)
        await self.session.commit()
        await self.session.refresh(group)
        return group

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[GroupExtension]:
        result = await self.session.execute(
            select(GroupExtension)
            .where(
                GroupExtension.customer_id == customer_id,
                GroupExtension.active.is_(True),
            )
            .order_by(GroupExtension.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, group_id: uuid.UUID, customer_id: uuid.UUID
    ) -> GroupExtension | None:
        result = await self.session.execute(
            select(GroupExtension).where(
                GroupExtension.id == group_id,
                GroupExtension.customer_id == customer_id,
                GroupExtension.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, group: GroupExtension) -> GroupExtension:
        group.active = False
        await self.session.commit()
        await self.session.refresh(group)
        return group
