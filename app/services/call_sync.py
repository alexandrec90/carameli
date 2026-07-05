from __future__ import annotations

import asyncio
import logging
from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from app.core.config import settings
from app.core.database import async_session_factory
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.customer_repo import CustomerRepo
from app.services import vanillasoft_notify
from app.services.agent_status_sync import (
    poll_agent_status,
)
from app.services.agent_status_sync import (
    shutdown as engine_shutdown,
)
from app.services.agent_status_sync import (
    startup as engine_startup,
)
from app.services.sms_sync import retry_unposted_sms_messages

logger = logging.getLogger(__name__)
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}


async def retry_unposted_events(ctx: dict) -> None:
    """Retry posting call events (older than 1 min) to VanillaSoft that failed on first attempt."""
    if not settings.vanillasoft_webhook_url:
        return

    async with async_session_factory() as session:
        repo = CallEventRepo(session)
        events = await repo.get_unposted()
        if not events:
            return

        logger.info("Found %d unposted call events; retrying…", len(events))
        customer_repo = CustomerRepo(session)

        # Pre-load all referenced customers in one round-trip batch.
        unique_ids = {e.customer_id for e in events if e.customer_id}
        fetched = await asyncio.gather(*[customer_repo.get_by_id(cid) for cid in unique_ids])
        customer_map = {c.id: c for c in fetched if c}

        for event in events:
            try:
                if (event.status or "").lower() not in _TERMINAL_CALL_STATUSES:
                    continue

                customer = customer_map.get(event.customer_id) if event.customer_id else None
                vs_customer_id = customer.vs_customer_id if customer else None

                posted = await vanillasoft_notify.post_notification(
                    vanillasoft_notify.INCOMING_CALL_PATH,
                    vanillasoft_notify.incoming_call_payload(event, vs_customer_id),
                )
                if posted:
                    await repo.mark_posted(event.id)
                    logger.info(
                        "Retry: posted call event %s to VanillaSoft",
                        event.call_sid,
                    )
            except Exception:
                logger.exception("Retry: failed to post call event %s", event.call_sid)


class WorkerSettings:
    functions: ClassVar[list] = []
    cron_jobs: ClassVar[list] = [
        cron(retry_unposted_events, second={0, 30}),
        cron(retry_unposted_sms_messages, second={0, 30}),
        cron(poll_agent_status, second={0, 30}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    on_startup = engine_startup
    on_shutdown = engine_shutdown
