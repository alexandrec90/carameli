from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group_extension import GroupExtension
from app.repositories.group_extension_repo import GroupExtensionRepo

logger = logging.getLogger(__name__)


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[GroupExtension]:
    return await GroupExtensionRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, group_id: uuid.UUID, customer_id: uuid.UUID
) -> GroupExtension | None:
    return await GroupExtensionRepo(session).get_for_customer(group_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    description: str,
    number: str,
    subscribed_extensions: list[str],
) -> GroupExtension:
    return await GroupExtensionRepo(session).create(
        customer_id=customer_id,
        description=description,
        number=number,
        subscribed_extensions=subscribed_extensions,
    )


async def deactivate(session: AsyncSession, group: GroupExtension) -> GroupExtension:
    return await GroupExtensionRepo(session).deactivate(group)
