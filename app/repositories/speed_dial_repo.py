from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.speed_dial import SpeedDial


class SpeedDialRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        code: str,
        phone_number: str,
        description: str = "",
    ) -> SpeedDial:
        sd = SpeedDial(
            customer_id=customer_id,
            code=code,
            phone_number=phone_number,
            description=description,
        )
        self.session.add(sd)
        await self.session.commit()
        await self.session.refresh(sd)
        return sd

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[SpeedDial]:
        result = await self.session.execute(
            select(SpeedDial)
            .where(
                SpeedDial.customer_id == customer_id,
                SpeedDial.active.is_(True),
            )
            .order_by(SpeedDial.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, dial_id: uuid.UUID, customer_id: uuid.UUID
    ) -> SpeedDial | None:
        result = await self.session.execute(
            select(SpeedDial).where(
                SpeedDial.id == dial_id,
                SpeedDial.customer_id == customer_id,
                SpeedDial.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, sd: SpeedDial) -> SpeedDial:
        sd.active = False
        await self.session.commit()
        await self.session.refresh(sd)
        return sd
