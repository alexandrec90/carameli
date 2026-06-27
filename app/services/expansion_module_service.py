from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expansion_module import ExpansionModule
from app.repositories.expansion_module_repo import ExpansionModuleRepo


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[ExpansionModule]:
    return await ExpansionModuleRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, module_id: uuid.UUID, customer_id: uuid.UUID
) -> ExpansionModule | None:
    return await ExpansionModuleRepo(session).get_for_customer(module_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    description: str,
    brand: str,
    model: str,
) -> ExpansionModule:
    return await ExpansionModuleRepo(session).create(
        customer_id=customer_id,
        description=description,
        brand=brand,
        model=model,
    )


async def deactivate(session: AsyncSession, em: ExpansionModule) -> ExpansionModule:
    return await ExpansionModuleRepo(session).deactivate(em)
