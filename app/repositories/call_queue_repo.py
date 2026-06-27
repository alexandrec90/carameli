from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_queue import CallQueue


class CallQueueRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        name: str,
        strategy: str = "round-robin",
    ) -> CallQueue:
        queue = CallQueue(customer_id=customer_id, name=name, strategy=strategy)
        self.session.add(queue)
        await self.session.commit()
        await self.session.refresh(queue)
        return queue

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[CallQueue]:
        result = await self.session.execute(
            select(CallQueue)
            .where(CallQueue.customer_id == customer_id, CallQueue.active.is_(True))
            .order_by(CallQueue.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, queue_id: uuid.UUID, customer_id: uuid.UUID
    ) -> CallQueue | None:
        result = await self.session.execute(
            select(CallQueue).where(
                CallQueue.id == queue_id,
                CallQueue.customer_id == customer_id,
                CallQueue.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, queue: CallQueue) -> CallQueue:
        queue.active = False
        await self.session.commit()
        await self.session.refresh(queue)
        return queue
