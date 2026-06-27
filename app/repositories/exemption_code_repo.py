from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.exemption_code import ExemptionCode


class ExemptionCodeRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        description: str,
        code: str,
        call_restrictions: str = "",
    ) -> ExemptionCode:
        ec = ExemptionCode(
            customer_id=customer_id,
            description=description,
            code=code,
            call_restrictions=call_restrictions,
        )
        self.session.add(ec)
        await self.session.commit()
        await self.session.refresh(ec)
        return ec

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[ExemptionCode]:
        result = await self.session.execute(
            select(ExemptionCode)
            .where(
                ExemptionCode.customer_id == customer_id,
                ExemptionCode.active.is_(True),
            )
            .order_by(ExemptionCode.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, exemption_id: uuid.UUID, customer_id: uuid.UUID
    ) -> ExemptionCode | None:
        result = await self.session.execute(
            select(ExemptionCode).where(
                ExemptionCode.id == exemption_id,
                ExemptionCode.customer_id == customer_id,
                ExemptionCode.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, ec: ExemptionCode) -> ExemptionCode:
        ec.active = False
        await self.session.commit()
        await self.session.refresh(ec)
        return ec
