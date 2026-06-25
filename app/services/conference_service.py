from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conference import Conference
from app.repositories.conference_repo import ConferenceRepo

logger = logging.getLogger(__name__)


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[Conference]:
    return await ConferenceRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, conference_id: uuid.UUID, customer_id: uuid.UUID
) -> Conference | None:
    return await ConferenceRepo(session).get_for_customer(conference_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    number: str,
    description: str,
    max_participants: int,
    recorded_calls: bool,
) -> Conference:
    return await ConferenceRepo(session).create(
        customer_id=customer_id,
        number=number,
        description=description,
        max_participants=max_participants,
        recorded_calls=recorded_calls,
    )


async def deactivate(session: AsyncSession, conference: Conference) -> Conference:
    return await ConferenceRepo(session).deactivate(conference)
