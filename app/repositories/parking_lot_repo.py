from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.parking_lot import ParkingLot

logger = logging.getLogger(__name__)


class ParkingLotRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        description: str,
        extension: str,
        ring_back_time_limit: int,
    ) -> ParkingLot:
        lot = ParkingLot(
            customer_id=customer_id,
            description=description,
            extension=extension,
            ring_back_time_limit=ring_back_time_limit,
        )
        self.session.add(lot)
        await self.session.commit()
        await self.session.refresh(lot)
        return lot

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[ParkingLot]:
        result = await self.session.execute(
            select(ParkingLot)
            .where(
                ParkingLot.customer_id == customer_id,
                ParkingLot.active.is_(True),
            )
            .order_by(ParkingLot.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, lot_id: uuid.UUID, customer_id: uuid.UUID
    ) -> ParkingLot | None:
        result = await self.session.execute(
            select(ParkingLot).where(
                ParkingLot.id == lot_id,
                ParkingLot.customer_id == customer_id,
                ParkingLot.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, lot: ParkingLot) -> ParkingLot:
        lot.active = False
        await self.session.commit()
        await self.session.refresh(lot)
        return lot
