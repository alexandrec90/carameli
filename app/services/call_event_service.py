from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_event import CallEvent
from app.repositories.call_event_repo import CallEventRepo

logger = logging.getLogger(__name__)


async def get_by_call_sid(session: AsyncSession, call_sid: str) -> CallEvent | None:
    return await CallEventRepo(session).get_by_call_sid(call_sid)


async def create_from_webhook(
    session: AsyncSession,
    customer_id: uuid.UUID | None,
    payload: dict[str, Any],
) -> CallEvent:
    return await CallEventRepo(session).create_from_webhook(
        customer_id=customer_id, payload=payload
    )


async def mark_posted(session: AsyncSession, event_id: uuid.UUID) -> None:
    await CallEventRepo(session).mark_posted(event_id)
