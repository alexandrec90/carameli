from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from app.models.agent_status import AgentStatus

logger = logging.getLogger(__name__)


class AgentStatusRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert_batch(self, rows: list[dict]) -> None:
        """Insert or update one row per sip_username.

        ``rows`` is a list of dicts with keys matching AgentStatus columns.
        On conflict (sip_username already exists), all mutable fields are
        overwritten and polled_at is set to now().
        """
        if not rows:
            return
        stmt = insert(AgentStatus).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["sip_username"],
            set_={
                "customer_id": stmt.excluded.customer_id,
                "extension_id": stmt.excluded.extension_id,
                "call_state": stmt.excluded.call_state,
                "call_sid": stmt.excluded.call_sid,
                "sip_registered": stmt.excluded.sip_registered,
                "polled_at": func.now(),
            },
        )
        await self.session.execute(stmt)
        await self.session.commit()

    async def get_for_customer(self, customer_id: uuid.UUID) -> list[AgentStatus]:
        """Return all agent status rows belonging to customer_id."""
        result = await self.session.execute(
            select(AgentStatus).where(AgentStatus.customer_id == customer_id)
        )
        return list(result.scalars().all())
