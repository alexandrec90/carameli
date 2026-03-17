from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer import Customer
from app.models.phone_line import PhoneLine
from app.repositories.customer_repo import CustomerRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.customer import CustomerCreate

logger = logging.getLogger(__name__)


async def get_by_vs_id(session: AsyncSession, vs_customer_id: int) -> Customer | None:
    return await CustomerRepo(session).get_by_vs_id(vs_customer_id)


async def get_by_id(session: AsyncSession, customer_id: uuid.UUID) -> Customer | None:
    return await CustomerRepo(session).get_by_id(customer_id)


async def create(session: AsyncSession, body: CustomerCreate) -> Customer:
    return await CustomerRepo(session).create(body)


async def get_phone_lines(session: AsyncSession, customer_id: uuid.UUID) -> list[PhoneLine]:
    return await PhoneLineRepo(session).get_all_for_customer(customer_id)
