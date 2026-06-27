from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expansion_module import ExpansionModule


class ExpansionModuleRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        description: str,
        brand: str,
        model: str,
    ) -> ExpansionModule:
        em = ExpansionModule(
            customer_id=customer_id,
            description=description,
            brand=brand,
            model=model,
        )
        self.session.add(em)
        await self.session.commit()
        await self.session.refresh(em)
        return em

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[ExpansionModule]:
        result = await self.session.execute(
            select(ExpansionModule)
            .where(
                ExpansionModule.customer_id == customer_id,
                ExpansionModule.active.is_(True),
            )
            .order_by(ExpansionModule.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, module_id: uuid.UUID, customer_id: uuid.UUID
    ) -> ExpansionModule | None:
        result = await self.session.execute(
            select(ExpansionModule).where(
                ExpansionModule.id == module_id,
                ExpansionModule.customer_id == customer_id,
                ExpansionModule.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, em: ExpansionModule) -> ExpansionModule:
        em.active = False
        await self.session.commit()
        await self.session.refresh(em)
        return em
