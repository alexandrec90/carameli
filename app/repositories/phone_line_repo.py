from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.phone_line import PhoneLine

logger = logging.getLogger(__name__)


class PhoneLineRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        phone_number: str,
        provider_sid: str,
    ) -> PhoneLine:
        line = PhoneLine(
            customer_id=customer_id,
            phone_number=phone_number,
            provider_sid=provider_sid,
        )
        self.session.add(line)
        await self.session.commit()
        await self.session.refresh(line)
        return line

    async def get_by_number(self, customer_id: uuid.UUID, phone_number: str) -> PhoneLine | None:
        result = await self.session.execute(
            select(PhoneLine).where(
                PhoneLine.customer_id == customer_id,
                PhoneLine.phone_number == phone_number,
                PhoneLine.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_all_for_customer(self, customer_id: uuid.UUID) -> list[PhoneLine]:
        result = await self.session.execute(
            select(PhoneLine).where(
                PhoneLine.customer_id == customer_id,
                PhoneLine.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def count_for_customer(self, customer_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(PhoneLine)
            .where(
                PhoneLine.customer_id == customer_id,
                PhoneLine.active.is_(True),
            )
        )
        return result.scalar_one()

    async def deactivate(self, line: PhoneLine) -> PhoneLine:
        line.active = False
        await self.session.commit()
        await self.session.refresh(line)
        return line

    async def update_sms_enabled(self, line: PhoneLine, enabled: bool) -> PhoneLine:
        line.sms_enabled = enabled
        await self.session.commit()
        await self.session.refresh(line)
        return line

    async def update_recording_enabled(self, line: PhoneLine, enabled: bool) -> PhoneLine:
        line.recording_enabled = enabled
        await self.session.commit()
        await self.session.refresh(line)
        return line

    async def get_by_phone_number_global(self, phone_number: str) -> PhoneLine | None:
        """Look up an active phone line by number without knowing the customer."""
        result = await self.session.execute(
            select(PhoneLine).where(
                PhoneLine.phone_number == phone_number,
                PhoneLine.active.is_(True),
            )
        )
        return result.scalar_one_or_none()
