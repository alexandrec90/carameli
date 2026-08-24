from __future__ import annotations

import logging
from collections.abc import Awaitable
from typing import cast

from arq.constants import default_queue_name
from prometheus_client import Counter, Gauge
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_event import CallEvent
from app.models.sms_message import SmsMessage

logger = logging.getLogger(__name__)

UNPOSTED_CALL_EVENTS = Gauge(
    "carameli_unposted_call_events",
    "Call events waiting to be posted to CRM.",
)
UNPOSTED_SMS_MESSAGES = Gauge(
    "carameli_unposted_sms_messages",
    "SMS messages waiting to be posted to CRM.",
)
ARQ_QUEUE_DEPTH = Gauge(
    "carameli_arq_queue_depth",
    "Jobs currently waiting in the default ARQ queue.",
)
WEBHOOK_FAILURES_TOTAL = Counter(
    "carameli_webhook_failures_total",
    "Failures encountered while rejecting or processing Jambonz and Telnyx webhooks.",
)


async def refresh_operational_metrics(
    session: AsyncSession,
    redis: Redis,
) -> None:
    """Refresh indexed backlog counts and the default ARQ queue depth."""
    call_count = (
        select(func.count())
        .select_from(CallEvent)
        .where(CallEvent.posted.is_(False))
        .scalar_subquery()
    )
    sms_count = (
        select(func.count())
        .select_from(SmsMessage)
        .where(SmsMessage.posted.is_(False))
        .scalar_subquery()
    )

    try:
        row = (await session.execute(select(call_count, sms_count))).one()
        UNPOSTED_CALL_EVENTS.set(int(row[0]))
        UNPOSTED_SMS_MESSAGES.set(int(row[1]))
    except Exception:
        logger.warning("Failed to refresh database backlog metrics", exc_info=True)

    try:
        queue_depth = await cast(Awaitable[int], redis.llen(default_queue_name))
        ARQ_QUEUE_DEPTH.set(queue_depth)
    except Exception:
        logger.warning("Failed to refresh ARQ queue-depth metric", exc_info=True)
