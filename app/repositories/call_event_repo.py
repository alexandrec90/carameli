from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_event import CallEvent


class CallEventRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_from_webhook(
        self,
        customer_id: uuid.UUID | None,
        payload: dict[str, Any],
    ) -> CallEvent:
        call_sid = payload.get("CallSid", "")
        existing = await self.get_by_call_sid(call_sid)
        if existing:
            return existing

        duration_str = payload.get("CallDuration")
        duration = int(duration_str) if duration_str else None

        event = CallEvent(
            customer_id=customer_id,
            twilio_call_sid=call_sid,
            direction=payload.get("Direction", "outbound"),
            from_number=payload.get("From"),
            to_number=payload.get("To"),
            status=payload.get("CallStatus"),
            duration_seconds=duration,
            recording_url=payload.get("RecordingUrl"),
            ended_at=datetime.utcnow(),
        )
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(event)
        return event

    async def get_by_call_sid(self, call_sid: str) -> CallEvent | None:
        result = await self.session.execute(
            select(CallEvent).where(CallEvent.twilio_call_sid == call_sid)
        )
        return result.scalar_one_or_none()

    async def get_unposted(self) -> list[CallEvent]:
        result = await self.session.execute(
            select(CallEvent).where(CallEvent.posted.is_(False)).limit(100)
        )
        return list(result.scalars().all())

    async def mark_posted(self, event: CallEvent) -> None:
        event.posted = True
        event.matched_at = datetime.utcnow()
        await self.session.commit()
