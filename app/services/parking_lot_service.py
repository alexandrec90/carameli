from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.parking_lot import ParkingLot
from app.repositories.parking_lot_repo import ParkingLotRepo

logger = logging.getLogger(__name__)


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[ParkingLot]:
    return await ParkingLotRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, lot_id: uuid.UUID, customer_id: uuid.UUID
) -> ParkingLot | None:
    return await ParkingLotRepo(session).get_for_customer(lot_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    description: str,
    extension: str,
    ring_back_time_limit: int,
) -> ParkingLot:
    return await ParkingLotRepo(session).create(
        customer_id=customer_id,
        description=description,
        extension=extension,
        ring_back_time_limit=ring_back_time_limit,
    )


async def deactivate(session: AsyncSession, lot: ParkingLot) -> ParkingLot:
    return await ParkingLotRepo(session).deactivate(lot)
