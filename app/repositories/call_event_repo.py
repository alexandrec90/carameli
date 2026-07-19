from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Integer, and_, case, cast, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_event import CallEvent

logger = logging.getLogger(__name__)

_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}

# Grouping dimensions supported by the CDR summary report (cloudli spec sections 30-34).
SUMMARY_GROUP_BY = ("extension", "number")
_DELETE_BATCH_SIZE = 10_000


@dataclass(frozen=True)
class CallSummaryAggregate:
    """A single grouped row of the CDR summary report.

    ``group_key`` is the extension number or customer-facing DID; ``success_rate`` is
    the answered/total ratio in the range [0, 1].
    """

    group_key: str
    call_count: int
    answered_count: int
    total_duration_seconds: int
    avg_duration_seconds: float
    success_rate: float


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
                existing.direction = payload.get("Direction")  # type: ignore[assignment]
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

    async def list_for_customer(
        self,
        customer_id: uuid.UUID,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 100,
    ) -> list[CallEvent]:
        """Return a customer's call events, newest first, with an optional date range.

        The date range filters on ``started_at`` (the call start). Rows with a null
        ``started_at`` are excluded once any bound is supplied.
        """
        stmt = select(CallEvent).where(CallEvent.customer_id == customer_id)
        if start is not None:
            stmt = stmt.where(CallEvent.started_at >= start)
        if end is not None:
            stmt = stmt.where(CallEvent.started_at <= end)
        stmt = stmt.order_by(CallEvent.created_at.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def summarize_for_customer(
        self,
        customer_id: uuid.UUID,
        group_by: str = "extension",
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[CallSummaryAggregate]:
        """Aggregate a customer's call events into per-group CDR statistics.

        ``group_by`` is ``"extension"`` (the dialled extension) or ``"number"`` (the
        customer-facing DID — ``to_number`` on inbound calls, ``from_number`` on
        outbound). The optional date range filters on ``started_at``. Rows are ordered
        by call count, busiest first.
        """
        if group_by not in SUMMARY_GROUP_BY:
            raise ValueError(f"Unsupported group_by: {group_by!r}")

        if group_by == "number":
            # Customer-facing DID: To on inbound, From on outbound.
            group_col = case(
                (CallEvent.direction == "inbound", CallEvent.to_number),
                else_=CallEvent.from_number,
            )
            key = func.coalesce(group_col, "")
        else:
            key = func.coalesce(CallEvent.extension, "")
        # Postgres FILTER clause: count only calls that reached a "completed" status.
        answered = func.count().filter(func.lower(CallEvent.status) == "completed")
        call_count = func.count()

        stmt = select(
            key.label("group_key"),
            call_count.label("call_count"),
            answered.label("answered_count"),
            cast(func.coalesce(func.sum(CallEvent.duration_seconds), 0), Integer).label(
                "total_duration_seconds"
            ),
            func.coalesce(func.avg(CallEvent.duration_seconds), 0).label("avg_duration_seconds"),
        ).where(CallEvent.customer_id == customer_id)
        if start is not None:
            stmt = stmt.where(CallEvent.started_at >= start)
        if end is not None:
            stmt = stmt.where(CallEvent.started_at <= end)
        stmt = stmt.group_by(key).order_by(call_count.desc())

        result = await self.session.execute(stmt)
        return [
            CallSummaryAggregate(
                group_key=row.group_key,
                call_count=row.call_count,
                answered_count=row.answered_count,
                total_duration_seconds=int(row.total_duration_seconds),
                avg_duration_seconds=round(float(row.avg_duration_seconds), 1),
                success_rate=(
                    round(row.answered_count / row.call_count, 4) if row.call_count else 0.0
                ),
            )
            for row in result.all()
        ]

    async def get_by_call_sid(self, call_sid: str) -> CallEvent | None:
        result = await self.session.execute(select(CallEvent).where(CallEvent.call_sid == call_sid))
        return result.scalar_one_or_none()

    async def get_existing_call_sids(self, call_sids: list[str]) -> set[str]:
        """Return the subset of ``call_sids`` that already have a call_events row.

        One batched ``SELECT ... WHERE call_sid IN (...)`` for the reconciliation
        diff (avoids N per-sid queries). An empty input yields an empty set.
        """
        if not call_sids:
            return set()
        result = await self.session.execute(
            select(CallEvent.call_sid).where(CallEvent.call_sid.in_(call_sids))
        )
        return set(result.scalars().all())

    async def get_by_call_sid_for_customer(
        self, call_sid: str, customer_id: uuid.UUID
    ) -> CallEvent | None:
        result = await self.session.execute(
            select(CallEvent).where(
                CallEvent.call_sid == call_sid,
                CallEvent.customer_id == customer_id,
            )
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

    async def delete_older_than(
        self,
        cutoff: datetime,
        *,
        batch_size: int = _DELETE_BATCH_SIZE,
    ) -> int:
        """Delete posted events before ``cutoff`` in independently committed batches."""
        if batch_size <= 0:
            raise ValueError("batch_size must be greater than zero")

        total_deleted = 0
        while True:
            batch_ids = (
                select(CallEvent.id)
                .where(
                    CallEvent.created_at < cutoff,
                    CallEvent.posted.is_(True),
                )
                .order_by(CallEvent.created_at, CallEvent.id)
                .limit(batch_size)
            )
            result = await self.session.execute(
                delete(CallEvent).where(CallEvent.id.in_(batch_ids)).returning(CallEvent.id)
            )
            deleted = len(result.scalars().all())
            await self.session.commit()
            total_deleted += deleted
            if deleted == 0:
                return total_deleted
