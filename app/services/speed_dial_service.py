from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.speed_dial import SpeedDial
from app.repositories.speed_dial_repo import SpeedDialRepo


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[SpeedDial]:
    return await SpeedDialRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, dial_id: uuid.UUID, customer_id: uuid.UUID
) -> SpeedDial | None:
    return await SpeedDialRepo(session).get_for_customer(dial_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    code: str,
    phone_number: str,
    description: str = "",
) -> SpeedDial:
    return await SpeedDialRepo(session).create(
        customer_id=customer_id,
        code=code,
        phone_number=phone_number,
        description=description,
    )


async def deactivate(session: AsyncSession, sd: SpeedDial) -> SpeedDial:
    return await SpeedDialRepo(session).deactivate(sd)
