from __future__ import annotations

import logging

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.core.database import async_session_factory
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.customer_repo import CustomerRepo

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}


def _vanillasoft_headers() -> dict[str, str]:
    if not settings.vanillasoft_webhook_secret:
        return {}
    return {"Authorization": f"Bearer {settings.vanillasoft_webhook_secret}"}


async def retry_unposted_events() -> None:
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

        for event in events:
            try:
                if (event.status or "").lower() not in _TERMINAL_CALL_STATUSES:
                    continue

                customer = None
                if event.customer_id:
                    customer = await customer_repo.get_by_id(event.customer_id)

                vs_payload = {
                    "call_sid": event.call_sid,
                    "vs_customer_id": customer.vs_customer_id if customer else None,
                    "from": event.from_number,
                    "to": event.to_number,
                    "extension": event.extension,
                    "duration_seconds": event.duration_seconds,
                    "recording_url": event.recording_url,
                    "status": event.status,
                    "started_at": event.started_at.isoformat()
                    if event.started_at
                    else None,
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


def start_scheduler() -> None:
    scheduler.add_job(
        retry_unposted_events,
        trigger="interval",
        seconds=30,
        id="retry_call_events",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("APScheduler started: retry_call_events every 30 seconds")


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
    logger.info("APScheduler stopped")
