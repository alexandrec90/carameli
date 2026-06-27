from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent


class AgentRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        customer_id: uuid.UUID,
        name: str,
        extension_id: uuid.UUID | None = None,
        status: str = "available",
    ) -> Agent:
        agent = Agent(
            customer_id=customer_id,
            name=name,
            extension_id=extension_id,
            status=status,
        )
        self.session.add(agent)
        await self.session.commit()
        await self.session.refresh(agent)
        return agent

    async def list_for_customer(self, customer_id: uuid.UUID) -> list[Agent]:
        result = await self.session.execute(
            select(Agent)
            .where(Agent.customer_id == customer_id, Agent.active.is_(True))
            .order_by(Agent.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_for_customer(self, agent_id: uuid.UUID, customer_id: uuid.UUID) -> Agent | None:
        result = await self.session.execute(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.customer_id == customer_id,
                Agent.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def deactivate(self, agent: Agent) -> Agent:
        agent.active = False
        await self.session.commit()
        await self.session.refresh(agent)
        return agent
