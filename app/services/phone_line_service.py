from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.phone_line import PhoneLine
from app.repositories.phone_line_repo import PhoneLineRepo
from app.services.providers.base import CarrierProvider

logger = logging.getLogger(__name__)


async def get_by_number(
    session: AsyncSession, customer_id: uuid.UUID, phone_number: str
) -> PhoneLine | None:
    return await PhoneLineRepo(session).get_by_number(customer_id, phone_number)


async def get_by_id(session: AsyncSession, phone_line_id: uuid.UUID) -> PhoneLine | None:
    return await PhoneLineRepo(session).get_by_id(phone_line_id)


async def get_all_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[PhoneLine]:
    return await PhoneLineRepo(session).get_all_for_customer(customer_id)


async def count_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> int:
    return await PhoneLineRepo(session).count_for_customer(customer_id)


async def acquire_did(
    carrier: CarrierProvider,
    *,
    phone_number: str | None,
    area_code: str | None,
    country_code: str,
) -> dict[str, Any]:
    """Provision a DID at the carrier, either a named number or one from an area code.

    Raises ``ValueError`` for a request the carrier cannot satisfy (no numbers in the
    area code, unusable number); the caller translates that to a 400. Any other
    exception is a provider failure and belongs on the 502 path.
    """
    if phone_number:
        return await carrier.provision_number(phone_number, country_code=country_code)
    if not area_code:
        raise ValueError("either phone_number or area_code is required")
    numbers = await carrier.search_numbers(area_code, 1, country_code=country_code)
    if not numbers:
        raise ValueError(f"No numbers available in area code {area_code}")
    return await carrier.provision_number(numbers[0]["phone_number"], country_code=country_code)


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


async def assign_branch(session: AsyncSession, line: PhoneLine, branch_id: int | None) -> PhoneLine:
    return await PhoneLineRepo(session).assign_branch(line, branch_id)


async def get_by_phone_number_global(session: AsyncSession, phone_number: str) -> PhoneLine | None:
    return await PhoneLineRepo(session).get_by_phone_number_global(phone_number)
