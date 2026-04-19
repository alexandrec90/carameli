from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sms_message import SmsMessage
from app.repositories.sms_message_repo import SmsMessageRepo

logger = logging.getLogger(__name__)


async def create_outbound(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID | None,
    phone_line_id: uuid.UUID | None,
    message_sid: str | None,
    from_number: str,
    to_number: str,
    body: str,
) -> SmsMessage:
    return await SmsMessageRepo(session).create(
        customer_id=customer_id,
        phone_line_id=phone_line_id,
        message_sid=message_sid,
        direction="outbound",
        from_number=from_number,
        to_number=to_number,
        body=body,
        delivery_status="queued",
    )


async def update_delivery_status(
    session: AsyncSession,
    message_sid: str,
    delivery_status: str,
    error_code: str | None,
) -> bool:
    return await SmsMessageRepo(session).update_delivery_status(
        message_sid, delivery_status, error_code
    )
