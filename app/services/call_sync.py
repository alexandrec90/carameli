from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.error_tracking import init_error_tracking
from app.core.heartbeat import ping
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.customer_repo import CustomerRepo
from app.services import retention, vanillasoft_notify
from app.services.agent_status_sync import (
    poll_agent_status,
)
from app.services.agent_status_sync import (
    shutdown as engine_shutdown,
)
from app.services.agent_status_sync import (
    startup as engine_startup,
)
from app.services.reconciliation import (
    reconcile_provider_records,
)
from app.services.reconciliation import (
    shutdown as carrier_shutdown,
)
from app.services.reconciliation import (
    startup as carrier_startup,
)
from app.services.sms_sync import retry_unposted_sms_messages

logger = logging.getLogger(__name__)
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}
_CronFunction = Callable[[dict], Awaitable[None]]


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


async def worker_startup(ctx: dict) -> None:
    """Compose the worker startup hooks: call engine (agent status) + carrier (reconciliation)."""
    init_error_tracking()
    await engine_startup(ctx)
    await carrier_startup(ctx)


async def worker_shutdown(ctx: dict) -> None:
    """Compose the worker shutdown hooks in reverse: carrier first, then call engine."""
    await carrier_shutdown(ctx)
    await engine_shutdown(ctx)


async def _run_scheduled_job(ctx: dict, job: _CronFunction, slug: str) -> None:
    """Run a cron target and ping its dead-man switch only after it returns."""
    await job(ctx)
    await ping(slug)


async def retry_unposted_events_cron(ctx: dict) -> None:
    await _run_scheduled_job(ctx, retry_unposted_events, "call-event-retry")


async def retry_unposted_sms_messages_cron(ctx: dict) -> None:
    await _run_scheduled_job(ctx, retry_unposted_sms_messages, "sms-retry")


async def poll_agent_status_cron(ctx: dict) -> None:
    await _run_scheduled_job(ctx, poll_agent_status, "agent-status")


async def reconcile_provider_records_cron(ctx: dict) -> None:
    await _run_scheduled_job(ctx, reconcile_provider_records, "provider-reconciliation")


async def purge_expired_cron(ctx: dict) -> None:
    await _run_scheduled_job(ctx, retention.purge_expired, "retention")


class WorkerSettings:
    functions: ClassVar[list] = []
    cron_jobs: ClassVar[list] = [
        cron(retry_unposted_events_cron, second={0, 30}),
        cron(retry_unposted_sms_messages_cron, second={0, 30}),
        cron(poll_agent_status_cron, second={0, 30}),
        cron(reconcile_provider_records_cron, minute={0, 10, 20, 30, 40, 50}, second=0),
        cron(purge_expired_cron, hour={4}, minute={0}, second=0),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    on_startup = worker_startup
    on_shutdown = worker_shutdown
