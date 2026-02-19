from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.database import async_session_factory
from app.repositories.call_event_repo import CallEventRepo

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def retry_unposted_events() -> None:
    """Retry call events that failed to be posted to VanillaSoft."""
    async with async_session_factory() as session:
        repo = CallEventRepo(session)
        events = await repo.get_unposted()
        if not events:
            return
        logger.info("Found %d unposted call events; retrying…", len(events))
        for event in events:
            try:
                # TODO: Post to VanillaSoft's internal API / write to SQL Server.
                # For now, mark as posted so the queue drains.
                await repo.mark_posted(event)
                logger.info("Marked call event %s as posted", event.twilio_call_sid)
            except Exception:
                logger.exception(
                    "Failed to post call event %s", event.twilio_call_sid
                )


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
