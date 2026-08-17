from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.sci_rule_repo import SciRuleRepo
from app.core.config import settings
from app.models.extension import Extension
from app.models.phone_line import PhoneLine
from app.models.sci_preparation import SciPreparation
from app.repositories.sci_preparation_repo import SciPreparationRepo

logger = logging.getLogger(__name__)


def _area_code(phone_number: str) -> str | None:
    digits = "".join(character for character in phone_number if character.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        return digits[1:4]
    if len(digits) == 10:
        return digits[:3]
    return None


def select_caller_id(lines: list[PhoneLine], candidate_area_codes: list[str]) -> PhoneLine | None:
    active_lines = sorted(
        (line for line in lines if line.active), key=lambda line: line.phone_number
    )
    for candidate in candidate_area_codes:
        for line in active_lines:
            if _area_code(line.phone_number) == candidate:
                return line
    return None


async def upsert(
    session: AsyncSession,
    customer_id: uuid.UUID,
    extension_id: uuid.UUID,
    zip_code: str,
    enabled: bool,
) -> None:
    await SciRuleRepo(session).upsert(
        customer_id=customer_id,
        extension_id=extension_id,
        zip_code=zip_code,
        enabled=enabled,
    )


async def update_extension_option(
    session: AsyncSession,
    customer_id: uuid.UUID,
    extension_id: uuid.UUID,
    enabled: bool,
) -> None:
    await SciRuleRepo(session).update_extension_option(
        customer_id=customer_id,
        extension_id=extension_id,
        enabled=enabled,
    )


async def prepare_call(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    extension: Extension,
    contact_id: int,
    destination_number: str,
    candidate_area_codes: list[str],
    lines: list[PhoneLine],
) -> SciPreparation:
    selected = select_caller_id(lines, candidate_area_codes)
    if not selected:
        raise ValueError("No active caller ID matches the supplied area codes")
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        seconds=settings.sci_preparation_ttl_seconds
    )
    return await SciPreparationRepo(session).upsert(
        customer_id=customer_id,
        extension_id=extension.id,
        contact_id=contact_id,
        destination_number=destination_number,
        candidate_area_codes=candidate_area_codes,
        selected_phone_line_id=selected.id,
        selected_caller_id=selected.phone_number,
        expires_at=expires_at,
    )


async def consume_prepared_call(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    extension: Extension,
    contact_id: int,
    destination_number: str,
) -> SciPreparation | None:
    return await SciPreparationRepo(session).claim(
        customer_id=customer_id,
        extension_id=extension.id,
        contact_id=contact_id,
        destination_number=destination_number,
    )


async def mark_prepared_call_consumed(session: AsyncSession, row: SciPreparation) -> None:
    await SciPreparationRepo(session).mark_consumed(row)
