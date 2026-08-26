from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sms_message import SmsMessage
from app.repositories.sms_message_repo import SmsMessageRepo

logger = logging.getLogger(__name__)


async def list_for_customer(
    session: AsyncSession,
    customer_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
    peer: str | None = None,
) -> list[SmsMessage]:
    return await SmsMessageRepo(session).list_for_customer(customer_id, start, end, limit, peer)


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


async def create_inbound(
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
        direction="inbound",
        from_number=from_number,
        to_number=to_number,
        body=body,
        delivery_status="received",
    )


async def get_by_message_sid(session: AsyncSession, message_sid: str) -> SmsMessage | None:
    return await SmsMessageRepo(session).get_by_message_sid(message_sid)


async def mark_posted(session: AsyncSession, message_id: uuid.UUID) -> None:
    await SmsMessageRepo(session).mark_posted(message_id)


async def update_delivery_status(
    session: AsyncSession,
    message_sid: str,
    delivery_status: str,
    error_code: str | None,
) -> bool:
    return await SmsMessageRepo(session).update_delivery_status(
        message_sid, delivery_status, error_code
    )
