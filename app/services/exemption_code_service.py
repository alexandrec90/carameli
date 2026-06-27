from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.exemption_code import ExemptionCode
from app.repositories.exemption_code_repo import ExemptionCodeRepo


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[ExemptionCode]:
    return await ExemptionCodeRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, exemption_id: uuid.UUID, customer_id: uuid.UUID
) -> ExemptionCode | None:
    return await ExemptionCodeRepo(session).get_for_customer(exemption_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    description: str,
    code: str,
    call_restrictions: str = "",
) -> ExemptionCode:
    return await ExemptionCodeRepo(session).create(
        customer_id=customer_id,
        description=description,
        code=code,
        call_restrictions=call_restrictions,
    )


async def deactivate(session: AsyncSession, ec: ExemptionCode) -> ExemptionCode:
    return await ExemptionCodeRepo(session).deactivate(ec)
