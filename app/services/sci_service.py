from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.sci_rule_repo import SciRuleRepo

logger = logging.getLogger(__name__)


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
