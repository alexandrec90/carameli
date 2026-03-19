from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import Extension
from app.repositories.extension_repo import ExtensionRepo

logger = logging.getLogger(__name__)


async def get_by_number(
    session: AsyncSession, customer_id: uuid.UUID, extension_number: str
) -> Extension | None:
    return await ExtensionRepo(session).get_by_number(customer_id, extension_number)


async def get_used_numbers(session: AsyncSession, customer_id: uuid.UUID) -> set[str]:
    return await ExtensionRepo(session).get_used_numbers(customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    extension_number: str,
    sip_username: str,
    sip_credential_sid: str | None,
    sip_domain_sid: str | None,
) -> Extension:
    return await ExtensionRepo(session).create(
        customer_id=customer_id,
        extension_number=extension_number,
        sip_username=sip_username,
        sip_credential_sid=sip_credential_sid,
        sip_domain_sid=sip_domain_sid,
    )


async def deactivate(session: AsyncSession, ext: Extension) -> Extension:
    return await ExtensionRepo(session).deactivate(ext)
