from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_skill import AgentSkill
from app.repositories.agent_skill_repo import AgentSkillRepo


async def list_for_customer(session: AsyncSession, customer_id: uuid.UUID) -> list[AgentSkill]:
    return await AgentSkillRepo(session).list_for_customer(customer_id)


async def get_for_customer(
    session: AsyncSession, skill_id: uuid.UUID, customer_id: uuid.UUID
) -> AgentSkill | None:
    return await AgentSkillRepo(session).get_for_customer(skill_id, customer_id)


async def create(
    session: AsyncSession,
    customer_id: uuid.UUID,
    agent_id: uuid.UUID,
    skill: str,
    level: int = 1,
) -> AgentSkill:
    return await AgentSkillRepo(session).create(
        customer_id=customer_id, agent_id=agent_id, skill=skill, level=level
    )


async def deactivate(session: AsyncSession, skill: AgentSkill) -> AgentSkill:
    return await AgentSkillRepo(session).deactivate(skill)
