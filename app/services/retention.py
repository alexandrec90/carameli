from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.core.database import async_session_factory
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.sms_message_repo import SmsMessageRepo

logger = logging.getLogger(__name__)


async def purge_expired(ctx: dict) -> None:
    """Delete posted call and SMS history outside the configured retention window."""
    del ctx
    if settings.retention_days <= 0:
        return

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=settings.retention_days)
    async with async_session_factory() as session:
        call_events_deleted = await CallEventRepo(session).delete_older_than(cutoff)
        sms_messages_deleted = await SmsMessageRepo(session).delete_older_than(cutoff)

    logger.info(
        "Retention purge complete cutoff=%s call_events_deleted=%d sms_messages_deleted=%d",
        cutoff.isoformat(),
        call_events_deleted,
        sms_messages_deleted,
    )
