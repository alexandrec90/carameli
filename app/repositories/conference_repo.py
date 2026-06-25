from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conference import Conference

logger = logging.getLogger(__name__)


class ConferenceRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        number: str,
        description: str,
        max_participants: int,
        recorded_calls: bool,
    ) -> Conference:
        conference = Conference(
            customer_id=customer_id,
            number=number,
            description=description,
            max_participants=max_participants,
            recorded_calls=recorded_calls,
        )
        self.session.add(conference)
        await self.session.commit()
        await self.session.refresh(conference)
        return conference

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[Conference]:
        result = await self.session.execute(
            select(Conference)
            .where(
                Conference.customer_id == customer_id,
                Conference.active.is_(True),
            )
            .order_by(Conference.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, conference_id: uuid.UUID, customer_id: uuid.UUID
    ) -> Conference | None:
        result = await self.session.execute(
            select(Conference).where(
                Conference.id == conference_id,
                Conference.customer_id == customer_id,
                Conference.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, conference: Conference) -> Conference:
        conference.active = False
        await self.session.commit()
        await self.session.refresh(conference)
        return conference
