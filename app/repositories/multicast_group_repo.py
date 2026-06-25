from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.multicast_group import MulticastGroup

logger = logging.getLogger(__name__)


class MulticastGroupRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        extension: str,
        description: str,
        extensions: list[str],
        users: list[str],
    ) -> MulticastGroup:
        group = MulticastGroup(
            customer_id=customer_id,
            extension=extension,
            description=description,
            extensions=extensions,
            users=users,
        )
        self.session.add(group)
        await self.session.commit()
        await self.session.refresh(group)
        return group

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[MulticastGroup]:
        result = await self.session.execute(
            select(MulticastGroup)
            .where(
                MulticastGroup.customer_id == customer_id,
                MulticastGroup.active.is_(True),
            )
            .order_by(MulticastGroup.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, group_id: uuid.UUID, customer_id: uuid.UUID
    ) -> MulticastGroup | None:
        result = await self.session.execute(
            select(MulticastGroup).where(
                MulticastGroup.id == group_id,
                MulticastGroup.customer_id == customer_id,
                MulticastGroup.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, group: MulticastGroup) -> MulticastGroup:
        group.active = False
        await self.session.commit()
        await self.session.refresh(group)
        return group
