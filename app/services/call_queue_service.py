from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_queue import CallQueue
from app.repositories.call_queue_repo import CallQueueRepo


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[CallQueue]:
    return await CallQueueRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, queue_id: uuid.UUID, customer_id: uuid.UUID
) -> CallQueue | None:
    return await CallQueueRepo(session).get_for_customer(queue_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    name: str,
    strategy: str = "round-robin",
) -> CallQueue:
    return await CallQueueRepo(session).create(
        customer_id=customer_id, name=name, strategy=strategy
    )


async def deactivate(session: AsyncSession, queue: CallQueue) -> CallQueue:
    return await CallQueueRepo(session).deactivate(queue)
