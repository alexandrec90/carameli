from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.repositories.agent_repo import AgentRepo


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[Agent]:
    return await AgentRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, agent_id: uuid.UUID, customer_id: uuid.UUID
) -> Agent | None:
    return await AgentRepo(session).get_for_customer(agent_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    name: str,
    extension_id: uuid.UUID | None = None,
    status: str = "available",
) -> Agent:
    return await AgentRepo(session).create(
        customer_id=customer_id,
        name=name,
        extension_id=extension_id,
        status=status,
    )


async def deactivate(session: AsyncSession, agent: Agent) -> Agent:
    return await AgentRepo(session).deactivate(agent)
