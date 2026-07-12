from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.services.providers.base import ProviderCallRecord, ProviderMessageRecord
from app.services.reconciliation import reconcile_provider_records, shutdown, startup

pytestmark = pytest.mark.asyncio(loop_scope="session")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _call_record(
    call_sid: str = "CA1",
    started_at: datetime | None = None,
    status: str = "completed",
) -> ProviderCallRecord:
    if started_at is None:
        started_at = datetime.now(UTC) - timedelta(minutes=30)
    return ProviderCallRecord(
        call_sid=call_sid,
        direction="inbound",
        from_number="+15550000001",
        to_number="+15550000002",
        started_at=started_at,
        status=status,
    )


def _message_record(
    message_sid: str = "SM1",
    created_at: datetime | None = None,
    status: str = "delivered",
) -> ProviderMessageRecord:
    if created_at is None:
        created_at = datetime.now(UTC) - timedelta(minutes=30)
    return ProviderMessageRecord(
        message_sid=message_sid,
        direction="inbound",
        from_number="+15550000001",
        to_number="+15550000002",
        created_at=created_at,
        status=status,
    )


def _mock_session() -> AsyncMock:
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


def _providers(
    calls: list[ProviderCallRecord] | None = None,
    messages: list[ProviderMessageRecord] | None = None,
) -> dict:
    engine = AsyncMock()
    engine.list_recent_calls = AsyncMock(return_value=calls or [])
    carrier = AsyncMock()
    carrier.list_recent_messages = AsyncMock(return_value=messages or [])
    return {"engine": engine, "carrier": carrier}


def _patch_repos(
    existing_call_sids: set[str] | None = None,
    existing_message_sids: set[str] | None = None,
):
    """Patch the session factory + both repos used inside reconciliation."""
    call_repo = AsyncMock()
    call_repo.get_existing_call_sids = AsyncMock(return_value=existing_call_sids or set())
    sms_repo = AsyncMock()
    sms_repo.get_existing_message_sids = AsyncMock(return_value=existing_message_sids or set())
    return (
        patch.multiple(
            "app.services.reconciliation",
            async_session_factory=lambda: _mock_session(),
            CallEventRepo=lambda _s: call_repo,
            SmsMessageRepo=lambda _s: sms_repo,
        ),
        call_repo,
        sms_repo,
    )


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------


async def test_disabled_flag_never_calls_providers(monkeypatch) -> None:
    """With reconciliation_enabled False, neither provider is queried."""
    monkeypatch.setattr(settings, "reconciliation_enabled", False)
    ctx = _providers(calls=[_call_record()], messages=[_message_record()])

    await reconcile_provider_records(ctx)

    ctx["engine"].list_recent_calls.assert_not_awaited()
    ctx["carrier"].list_recent_messages.assert_not_awaited()


# ---------------------------------------------------------------------------
# Calls diff
# ---------------------------------------------------------------------------


async def test_call_with_matching_local_row_logs_no_error(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    ctx = _providers(calls=[_call_record(call_sid="CA1")])
    patcher, _call_repo, _sms_repo = _patch_repos(existing_call_sids={"CA1"})

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    assert not [r for r in caplog.records if r.levelno == logging.ERROR]


async def test_call_missing_locally_logs_exactly_one_error(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    ctx = _providers(calls=[_call_record(call_sid="CAmissing")])
    patcher, _call_repo, _sms_repo = _patch_repos(existing_call_sids=set())

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert "CAmissing" in errors[0].getMessage()
    assert "has no call_events row" in errors[0].getMessage()


async def test_call_inside_grace_window_is_skipped(monkeypatch, caplog) -> None:
    """A call started within the 5-min grace window is not flagged (webhook may be in flight)."""
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    recent = datetime.now(UTC) - timedelta(minutes=1)
    ctx = _providers(calls=[_call_record(call_sid="CAfresh", started_at=recent)])
    patcher, call_repo, _sms_repo = _patch_repos(existing_call_sids=set())

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    assert not [r for r in caplog.records if r.levelno == logging.ERROR]
    # Grace-skipped record is excluded from the existence lookup entirely.
    call_repo.get_existing_call_sids.assert_awaited_once_with([])


# ---------------------------------------------------------------------------
# Messages diff (mirrors the call cases)
# ---------------------------------------------------------------------------


async def test_message_with_matching_local_row_logs_no_error(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    ctx = _providers(messages=[_message_record(message_sid="SM1")])
    patcher, _call_repo, _sms_repo = _patch_repos(existing_message_sids={"SM1"})

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    assert not [r for r in caplog.records if r.levelno == logging.ERROR]


async def test_message_missing_locally_logs_exactly_one_error(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    ctx = _providers(messages=[_message_record(message_sid="SMmissing")])
    patcher, _call_repo, _sms_repo = _patch_repos(existing_message_sids=set())

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert "SMmissing" in errors[0].getMessage()
    assert "has no sms_messages row" in errors[0].getMessage()


async def test_message_inside_grace_window_is_skipped(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    recent = datetime.now(UTC) - timedelta(minutes=2)
    ctx = _providers(messages=[_message_record(message_sid="SMfresh", created_at=recent)])
    patcher, _call_repo, sms_repo = _patch_repos(existing_message_sids=set())

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    assert not [r for r in caplog.records if r.levelno == logging.ERROR]
    sms_repo.get_existing_message_sids.assert_awaited_once_with([])


# ---------------------------------------------------------------------------
# Fault isolation
# ---------------------------------------------------------------------------


async def test_engine_failure_does_not_kill_message_diff(monkeypatch, caplog) -> None:
    """A raising call engine is logged via logger.exception; the message diff still runs."""
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    ctx = _providers(messages=[_message_record(message_sid="SMmissing")])
    ctx["engine"].list_recent_calls = AsyncMock(side_effect=RuntimeError("jambonz down"))
    patcher, _call_repo, _sms_repo = _patch_repos(existing_message_sids=set())

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    # The engine failure was logged...
    assert any("list_recent_calls failed" in m for m in messages)
    # ...and the message diff still detected the missing row.
    assert any("SMmissing" in m for m in messages)


async def test_carrier_failure_does_not_kill_call_diff(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "reconciliation_enabled", True)
    ctx = _providers(calls=[_call_record(call_sid="CAmissing")])
    ctx["carrier"].list_recent_messages = AsyncMock(side_effect=RuntimeError("telnyx down"))
    patcher, _call_repo, _sms_repo = _patch_repos(existing_call_sids=set())

    with patcher, caplog.at_level(logging.ERROR):
        await reconcile_provider_records(ctx)

    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("list_recent_messages failed" in m for m in messages)
    assert any("CAmissing" in m for m in messages)


# ---------------------------------------------------------------------------
# Provider lifecycle hooks
# ---------------------------------------------------------------------------


async def test_startup_sets_carrier_on_ctx() -> None:
    ctx: dict = {}
    fake_carrier = AsyncMock()
    with patch("app.services.providers.factory.get_carrier_provider", return_value=fake_carrier):
        await startup(ctx)

    assert ctx["carrier"] is fake_carrier


async def test_shutdown_closes_carrier() -> None:
    fake_carrier = AsyncMock()
    await shutdown({"carrier": fake_carrier})
    fake_carrier.aclose.assert_awaited_once()


async def test_shutdown_without_carrier_is_noop() -> None:
    await shutdown({})  # ctx has no "carrier" — must not raise
