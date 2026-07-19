from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.call_event import CallEvent
from app.models.sms_message import SmsMessage
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.sms_message_repo import SmsMessageRepo
from app.services import retention
from app.services.call_sync import WorkerSettings, purge_expired_cron

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_call_event_purge_batches_old_posted_rows_and_keeps_protected_rows(
    db_session: AsyncSession,
) -> None:
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=30)
    rows = [
        CallEvent(
            call_sid=f"CA-retention-old-{index}",
            direction="inbound",
            posted=True,
            created_at=now - timedelta(days=31 + index),
        )
        for index in range(3)
    ]
    rows.extend(
        [
            CallEvent(
                call_sid="CA-retention-new",
                direction="inbound",
                posted=True,
                created_at=now - timedelta(days=29),
            ),
            CallEvent(
                call_sid="CA-retention-unposted",
                direction="inbound",
                posted=False,
                created_at=now - timedelta(days=90),
            ),
        ]
    )
    db_session.add_all(rows)
    await db_session.commit()

    deleted = await CallEventRepo(db_session).delete_older_than(cutoff, batch_size=2)

    remaining = set((await db_session.execute(select(CallEvent.call_sid))).scalars().all())
    assert deleted == 3
    assert remaining == {"CA-retention-new", "CA-retention-unposted"}


async def test_sms_purge_batches_old_posted_rows_and_keeps_protected_rows(
    db_session: AsyncSession,
) -> None:
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=30)
    rows = [
        SmsMessage(
            message_sid=f"SM-retention-old-{index}",
            direction="inbound",
            from_number="+15550000001",
            to_number="+15550000002",
            body="old",
            posted=True,
            created_at=now - timedelta(days=31 + index),
        )
        for index in range(3)
    ]
    rows.extend(
        [
            SmsMessage(
                message_sid="SM-retention-new",
                direction="inbound",
                from_number="+15550000001",
                to_number="+15550000002",
                body="new",
                posted=True,
                created_at=now - timedelta(days=29),
            ),
            SmsMessage(
                message_sid="SM-retention-unposted",
                direction="inbound",
                from_number="+15550000001",
                to_number="+15550000002",
                body="protected",
                posted=False,
                created_at=now - timedelta(days=90),
            ),
        ]
    )
    db_session.add_all(rows)
    await db_session.commit()

    deleted = await SmsMessageRepo(db_session).delete_older_than(cutoff, batch_size=2)

    remaining = set((await db_session.execute(select(SmsMessage.message_sid))).scalars().all())
    assert deleted == 3
    assert remaining == {"SM-retention-new", "SM-retention-unposted"}


async def test_purge_disabled_does_not_open_database_session(monkeypatch) -> None:
    monkeypatch.setattr(settings, "retention_days", 0)

    def unexpected_session_factory() -> None:
        raise AssertionError("disabled retention must not open a database session")

    monkeypatch.setattr(retention, "async_session_factory", unexpected_session_factory)

    await retention.purge_expired({})


async def test_purge_expired_deletes_both_tables_and_logs_counts(
    db_session: AsyncSession,
    monkeypatch,
    caplog,
) -> None:
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    call = CallEvent(
        call_sid="CA-retention-service",
        direction="inbound",
        posted=True,
        created_at=old,
    )
    message = SmsMessage(
        message_sid="SM-retention-service",
        direction="inbound",
        from_number="+15550000001",
        to_number="+15550000002",
        body="old",
        posted=True,
        created_at=old,
    )
    db_session.add_all([call, message])
    await db_session.commit()

    @asynccontextmanager
    async def test_session_factory() -> AsyncIterator[AsyncSession]:
        yield db_session

    monkeypatch.setattr(settings, "retention_days", 1)
    monkeypatch.setattr(retention, "async_session_factory", test_session_factory)

    with caplog.at_level("INFO", logger="app.services.retention"):
        await retention.purge_expired({})

    assert await db_session.get(CallEvent, call.id) is None
    assert await db_session.get(SmsMessage, message.id) is None
    assert "call_events_deleted=1 sms_messages_deleted=1" in caplog.text


async def test_retention_cron_runs_daily_at_0400() -> None:
    job = next(
        cron_job
        for cron_job in WorkerSettings.cron_jobs
        if cron_job.coroutine is purge_expired_cron
    )

    assert job.hour == {4}
    assert job.minute == {0}
    assert job.second == 0
