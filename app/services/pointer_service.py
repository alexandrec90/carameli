from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.did_pointer import DidPointer
from app.repositories.did_pointer_repo import DidPointerRepo

logger = logging.getLogger(__name__)


async def create(
    session: AsyncSession,
    phone_line_id: uuid.UUID,
    extension_id: uuid.UUID,
) -> DidPointer:
    return await DidPointerRepo(session).create(
        phone_line_id=phone_line_id, extension_id=extension_id
    )


async def get(
    session: AsyncSession,
    phone_line_id: uuid.UUID,
    extension_id: uuid.UUID,
) -> DidPointer | None:
    return await DidPointerRepo(session).get(phone_line_id=phone_line_id, extension_id=extension_id)


async def get_for_phone_line(session: AsyncSession, phone_line_id: uuid.UUID) -> DidPointer | None:
    return await DidPointerRepo(session).get_for_phone_line(phone_line_id)


async def delete(session: AsyncSession, pointer: DidPointer) -> None:
    await DidPointerRepo(session).delete(pointer)
