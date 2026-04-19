from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.phone_line import PhoneLine
from app.repositories.phone_line_repo import PhoneLineRepo

logger = logging.getLogger(__name__)


async def get_by_number(
    session: AsyncSession, customer_id: uuid.UUID, phone_number: str
) -> PhoneLine | None:
    return await PhoneLineRepo(session).get_by_number(customer_id, phone_number)


async def get_all_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[PhoneLine]:
    return await PhoneLineRepo(session).get_all_for_customer(customer_id)


async def count_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> int:
    return await PhoneLineRepo(session).count_for_customer(customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    phone_number: str,
    provider_sid: str,
) -> PhoneLine:
    return await PhoneLineRepo(session).create(
        customer_id=customer_id,
        phone_number=phone_number,
        provider_sid=provider_sid,
    )


async def deactivate(session: AsyncSession, line: PhoneLine) -> PhoneLine:
    return await PhoneLineRepo(session).deactivate(line)


async def update_sms_enabled(session: AsyncSession, line: PhoneLine, enabled: bool) -> PhoneLine:
    return await PhoneLineRepo(session).update_sms_enabled(line, enabled)


async def update_recording_enabled(
    session: AsyncSession, line: PhoneLine, enabled: bool
) -> PhoneLine:
    return await PhoneLineRepo(session).update_recording_enabled(line, enabled)


async def update_auto_attendant(
    session: AsyncSession, line: PhoneLine, enabled: bool, max_digits: int | None
) -> PhoneLine:
    return await PhoneLineRepo(session).update_auto_attendant(line, enabled, max_digits)


async def get_by_phone_number_global(session: AsyncSession, phone_number: str) -> PhoneLine | None:
    return await PhoneLineRepo(session).get_by_phone_number_global(phone_number)
