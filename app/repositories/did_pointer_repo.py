from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.did_pointer import DidPointer


class DidPointerRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self, phone_line_id: uuid.UUID, extension_id: uuid.UUID
    ) -> DidPointer:
        existing = await self.get(
            phone_line_id=phone_line_id, extension_id=extension_id
        )
        if existing:
            return existing

        pointer = DidPointer(
            phone_line_id=phone_line_id,
            extension_id=extension_id,
        )
        self.session.add(pointer)
        await self.session.commit()
        await self.session.refresh(pointer)
        return pointer

    async def get(
        self, phone_line_id: uuid.UUID, extension_id: uuid.UUID
    ) -> DidPointer | None:
        result = await self.session.execute(
            select(DidPointer).where(
                DidPointer.phone_line_id == phone_line_id,
                DidPointer.extension_id == extension_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_for_phone_line(self, phone_line_id: uuid.UUID) -> DidPointer | None:
        """Return the first pointer mapped to a phone line (for inbound routing)."""
        result = await self.session.execute(
            select(DidPointer).where(DidPointer.phone_line_id == phone_line_id)
        )
        return result.scalars().first()

    async def delete(self, pointer: DidPointer) -> None:
        await self.session.delete(pointer)
        await self.session.commit()
