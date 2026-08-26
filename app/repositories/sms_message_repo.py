from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sms_message import SmsMessage

logger = logging.getLogger(__name__)

_RETRY_AGE = timedelta(minutes=1)
_DELETE_BATCH_SIZE = 10_000


class SmsMessageRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        customer_id: uuid.UUID | None,
        phone_line_id: uuid.UUID | None,
        message_sid: str | None,
        direction: str,
        from_number: str,
        to_number: str,
        body: str,
        delivery_status: str | None = None,
    ) -> SmsMessage:
        msg = SmsMessage(
            customer_id=customer_id,
            phone_line_id=phone_line_id,
            message_sid=message_sid,
            direction=direction,
            from_number=from_number,
            to_number=to_number,
            body=body,
            delivery_status=delivery_status,
        )
        self.session.add(msg)
        await self.session.commit()
        await self.session.refresh(msg)
        return msg

    async def get_by_message_sid(self, message_sid: str) -> SmsMessage | None:
        result = await self.session.execute(
            select(SmsMessage).where(SmsMessage.message_sid == message_sid)
        )
        return result.scalar_one_or_none()

    async def get_existing_message_sids(self, message_sids: list[str]) -> set[str]:
        """Return the subset of ``message_sids`` that already have an sms_messages row.

        One batched ``SELECT ... WHERE message_sid IN (...)`` for the reconciliation
        diff (avoids N per-sid queries). An empty input yields an empty set.
        """
        if not message_sids:
            return set()
        result = await self.session.execute(
            select(SmsMessage.message_sid).where(SmsMessage.message_sid.in_(message_sids))
        )
        return {sid for sid in result.scalars().all() if sid is not None}

    async def list_for_customer(
        self,
        customer_id: uuid.UUID,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 100,
        peer: str | None = None,
    ) -> list[SmsMessage]:
        """Return a customer's SMS messages, newest first, with an optional created_at range.

        `peer` narrows the result to one conversation: every message this customer
        exchanged with that number, in either direction. It is an additional filter on
        the customer-scoped query rather than a query of its own, so a peer belonging to
        another customer's history matches nothing here.
        """
        stmt = select(SmsMessage).where(SmsMessage.customer_id == customer_id)
        if peer is not None:
            stmt = stmt.where(or_(SmsMessage.from_number == peer, SmsMessage.to_number == peer))
        if start is not None:
            stmt = stmt.where(SmsMessage.created_at >= start)
        if end is not None:
            stmt = stmt.where(SmsMessage.created_at <= end)
        stmt = stmt.order_by(SmsMessage.created_at.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update_delivery_status(
        self,
        message_sid: str,
        delivery_status: str,
        error_code: str | None,
    ) -> bool:
        """Update delivery_status and error_code for a given message_sid.

        Returns True if the row was found and updated, False otherwise.
        """
        result = await self.session.execute(
            update(SmsMessage)
            .where(SmsMessage.message_sid == message_sid)
            .values(delivery_status=delivery_status, error_code=error_code)
            .returning(SmsMessage.id)
        )
        await self.session.commit()
        return result.scalar_one_or_none() is not None

    async def get_unposted_inbound(self) -> list[SmsMessage]:
        """Inbound messages not yet forwarded to CRM, older than 1 minute."""
        cutoff = datetime.now(UTC).replace(tzinfo=None) - _RETRY_AGE
        result = await self.session.execute(
            select(SmsMessage)
            .where(
                and_(
                    SmsMessage.posted.is_(False),
                    SmsMessage.direction == "inbound",
                    SmsMessage.created_at < cutoff,
                )
            )
            .limit(100)
        )
        return list(result.scalars().all())

    async def mark_posted(self, message_id: uuid.UUID) -> None:
        await self.session.execute(
            update(SmsMessage).where(SmsMessage.id == message_id).values(posted=True)
        )
        await self.session.commit()

    async def delete_older_than(
        self,
        cutoff: datetime,
        *,
        batch_size: int = _DELETE_BATCH_SIZE,
    ) -> int:
        """Delete posted messages before ``cutoff`` in independently committed batches."""
        if batch_size <= 0:
            raise ValueError("batch_size must be greater than zero")

        total_deleted = 0
        while True:
            batch_ids = (
                select(SmsMessage.id)
                .where(
                    SmsMessage.created_at < cutoff,
                    SmsMessage.posted.is_(True),
                )
                .order_by(SmsMessage.created_at, SmsMessage.id)
                .limit(batch_size)
            )
            result = await self.session.execute(
                delete(SmsMessage).where(SmsMessage.id.in_(batch_ids)).returning(SmsMessage.id)
            )
            deleted = len(result.scalars().all())
            await self.session.commit()
            total_deleted += deleted
            if deleted == 0:
                return total_deleted
