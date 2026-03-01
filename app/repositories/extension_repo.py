from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import Extension


class ExtensionRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        extension_number: str,
        sip_username: str,
        sip_credential_sid: str | None = None,
        twilio_domain_sid: str | None = None,
    ) -> Extension:
        ext = Extension(
            customer_id=customer_id,
            extension_number=extension_number,
            sip_username=sip_username,
            sip_credential_sid=sip_credential_sid,
            twilio_domain_sid=twilio_domain_sid,
        )
        self.session.add(ext)
        await self.session.commit()
        await self.session.refresh(ext)
        return ext

    async def get_by_number(
        self, customer_id: uuid.UUID, extension_number: str
    ) -> Extension | None:
        result = await self.session.execute(
            select(Extension).where(
                Extension.customer_id == customer_id,
                Extension.extension_number == extension_number,
                Extension.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_all_for_customer(self, customer_id: uuid.UUID) -> list[Extension]:
        result = await self.session.execute(
            select(Extension).where(
                Extension.customer_id == customer_id,
                Extension.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def get_used_numbers(self, customer_id: uuid.UUID) -> set[str]:
        result = await self.session.execute(
            select(Extension.extension_number).where(
                Extension.customer_id == customer_id,
                Extension.active.is_(True),
            )
        )
        return {row[0] for row in result.all()}

    async def get_by_id(self, extension_id: uuid.UUID) -> Extension | None:
        result = await self.session.execute(
            select(Extension).where(
                Extension.id == extension_id,
                Extension.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, ext: Extension) -> Extension:
        ext.active = False
        await self.session.commit()
        await self.session.refresh(ext)
        return ext
