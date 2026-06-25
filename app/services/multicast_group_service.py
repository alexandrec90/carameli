from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.multicast_group import MulticastGroup
from app.repositories.multicast_group_repo import MulticastGroupRepo

logger = logging.getLogger(__name__)


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[MulticastGroup]:
    return await MulticastGroupRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, group_id: uuid.UUID, customer_id: uuid.UUID
) -> MulticastGroup | None:
    return await MulticastGroupRepo(session).get_for_customer(group_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    extension: str,
    description: str,
    extensions: list[str],
    users: list[str],
) -> MulticastGroup:
    return await MulticastGroupRepo(session).create(
        customer_id=customer_id,
        extension=extension,
        description=description,
        extensions=extensions,
        users=users,
    )


async def deactivate(session: AsyncSession, group: MulticastGroup) -> MulticastGroup:
    return await MulticastGroupRepo(session).deactivate(group)
