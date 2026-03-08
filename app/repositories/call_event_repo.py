from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_event import CallEvent

_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}


def _utcnow_naive() -> datetime:
    """Return a naive UTC datetime for compatibility with existing schema columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class CallEventRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_from_webhook(
        self,
        customer_id: uuid.UUID | None,
        payload: dict[str, Any],
    ) -> CallEvent:
        call_sid = payload.get("CallSid", "")
        if not call_sid:
            raise ValueError("CallSid is required")

        status = payload.get("CallStatus")
        duration = self._parse_int(payload.get("CallDuration"))
        now = _utcnow_naive()

        existing = await self.get_by_call_sid(call_sid)
        if existing:
            if customer_id and not existing.customer_id:
                existing.customer_id = customer_id
            if payload.get("Direction"):
                existing.direction = payload.get("Direction")
            if payload.get("From"):
                existing.from_number = payload.get("From")
            if payload.get("To"):
                existing.to_number = payload.get("To")
            if payload.get("Extension"):
                existing.extension = payload.get("Extension")
            if status:
                existing.status = status
            if duration is not None:
                existing.duration_seconds = duration
            if payload.get("RecordingUrl"):
                existing.recording_url = payload.get("RecordingUrl")

            if existing.started_at is None:
                existing.started_at = now
            if (status or "").lower() in _TERMINAL_CALL_STATUSES:
                existing.ended_at = now

            await self.session.commit()
            await self.session.refresh(existing)
            return existing

        event = CallEvent(
            customer_id=customer_id,
            call_sid=call_sid,
            direction=payload.get("Direction", "outbound"),
            from_number=payload.get("From"),
            to_number=payload.get("To"),
            extension=payload.get("Extension"),
            status=status,
            started_at=now,
            duration_seconds=duration,
            recording_url=payload.get("RecordingUrl"),
            ended_at=now if (status or "").lower() in _TERMINAL_CALL_STATUSES else None,
        )
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(event)
        return event

    @staticmethod
    def _parse_int(value: Any) -> int | None:
        if value is None or value == "":
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    async def get_by_call_sid(self, call_sid: str) -> CallEvent | None:
        result = await self.session.execute(
            select(CallEvent).where(CallEvent.call_sid == call_sid)
        )
        return result.scalar_one_or_none()

    async def get_unposted(self) -> list[CallEvent]:
        """Return events not yet posted to VanillaSoft, created more than 1 minute ago."""
        cutoff = _utcnow_naive() - timedelta(minutes=1)
        result = await self.session.execute(
            select(CallEvent)
            .where(
                and_(
                    CallEvent.posted.is_(False),
                    CallEvent.created_at < cutoff,
                )
            )
            .limit(100)
        )
        return list(result.scalars().all())

    async def mark_posted(self, event_id: uuid.UUID) -> None:
        await self.session.execute(
            update(CallEvent)
            .where(CallEvent.id == event_id)
            .values(posted=True, matched_at=_utcnow_naive())
        )
        await self.session.commit()
