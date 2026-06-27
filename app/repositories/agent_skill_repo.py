from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_skill import AgentSkill


class AgentSkillRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        agent_id: uuid.UUID,
        skill: str,
        level: int = 1,
    ) -> AgentSkill:
        s = AgentSkill(customer_id=customer_id, agent_id=agent_id, skill=skill, level=level)
        self.session.add(s)
        await self.session.commit()
        await self.session.refresh(s)
        return s

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[AgentSkill]:
        result = await self.session.execute(
            select(AgentSkill)
            .where(
                AgentSkill.customer_id == customer_id,
                AgentSkill.active.is_(True),
            )
            .order_by(AgentSkill.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(
        self, skill_id: uuid.UUID, customer_id: uuid.UUID
    ) -> AgentSkill | None:
        result = await self.session.execute(
            select(AgentSkill).where(
                AgentSkill.id == skill_id,
                AgentSkill.customer_id == customer_id,
                AgentSkill.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, skill: AgentSkill) -> AgentSkill:
        skill.active = False
        await self.session.commit()
        await self.session.refresh(skill)
        return skill
