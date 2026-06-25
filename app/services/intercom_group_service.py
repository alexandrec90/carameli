from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intercom_group import IntercomGroup
from app.repositories.intercom_group_repo import IntercomGroupRepo

logger = logging.getLogger(__name__)


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[IntercomGroup]:
    return await IntercomGroupRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, group_id: uuid.UUID, customer_id: uuid.UUID
) -> IntercomGroup | None:
    return await IntercomGroupRepo(session).get_for_customer(group_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    number: str,
    description: str,
    subscriber_extensions: list[str],
    bidirectional_audio: bool,
    expiry: str | None,
) -> IntercomGroup:
    return await IntercomGroupRepo(session).create(
        customer_id=customer_id,
        number=number,
        description=description,
        subscriber_extensions=subscriber_extensions,
        bidirectional_audio=bidirectional_audio,
        expiry=expiry,
    )


async def deactivate(session: AsyncSession, group: IntercomGroup) -> IntercomGroup:
    return await IntercomGroupRepo(session).deactivate(group)
