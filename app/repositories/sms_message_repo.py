from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sms_message import SmsMessage

logger = logging.getLogger(__name__)

_RETRY_AGE = timedelta(minutes=1)


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

    async def list_for_customer(
        self,
        customer_id: uuid.UUID,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 100,
    ) -> list[SmsMessage]:
        """Return a customer's SMS messages, newest first, with an optional created_at range."""
        stmt = select(SmsMessage).where(SmsMessage.customer_id == customer_id)
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
        """Inbound messages not yet forwarded to VanillaSoft, older than 1 minute."""
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
