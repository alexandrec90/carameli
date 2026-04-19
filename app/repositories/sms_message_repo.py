from __future__ import annotations

import logging
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sms_message import SmsMessage

logger = logging.getLogger(__name__)


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
