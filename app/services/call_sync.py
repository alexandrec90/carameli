from __future__ import annotations

import asyncio
import logging
from typing import ClassVar

import httpx
from arq import cron
from arq.connections import RedisSettings

from app.core.config import settings
from app.core.database import async_session_factory
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.customer_repo import CustomerRepo
from app.services.agent_status_sync import (
    poll_agent_status,
)
from app.services.agent_status_sync import (
    shutdown as engine_shutdown,
)
from app.services.agent_status_sync import (
    startup as engine_startup,
)

logger = logging.getLogger(__name__)
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}


def _vanillasoft_headers() -> dict[str, str]:
    if not settings.vanillasoft_webhook_secret:
        return {}
    return {"Authorization": f"Bearer {settings.vanillasoft_webhook_secret}"}


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

                vs_payload = {
                    "call_sid": event.call_sid,
                    "vs_customer_id": customer.vs_customer_id if customer else None,
                    "from": event.from_number,
                    "to": event.to_number,
                    "extension": event.extension,
                    "duration_seconds": event.duration_seconds,
                    "recording_url": event.recording_url,
                    "status": event.status,
                    "started_at": event.started_at.isoformat() if event.started_at else None,
                    "ended_at": event.ended_at.isoformat() if event.ended_at else None,
                }

                async with httpx.AsyncClient() as http_client:
                    resp = await http_client.post(
                        settings.vanillasoft_webhook_url,
                        json=vs_payload,
                        headers=_vanillasoft_headers(),
                        timeout=10.0,
                    )

                if resp.is_success:
                    await repo.mark_posted(event.id)
                    logger.info(
                        "Retry: posted call event %s to VanillaSoft",
                        event.call_sid,
                    )
                else:
                    logger.warning(
                        "Retry: VanillaSoft webhook returned %s for call_sid=%s",
                        resp.status_code,
                        event.call_sid,
                    )
            except Exception:
                logger.exception("Retry: failed to post call event %s", event.call_sid)


class WorkerSettings:
    functions: ClassVar[list] = []
    cron_jobs: ClassVar[list] = [
        cron(retry_unposted_events, second={0, 30}),
        cron(poll_agent_status, second={0, 30}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    on_startup = engine_startup
    on_shutdown = engine_shutdown
