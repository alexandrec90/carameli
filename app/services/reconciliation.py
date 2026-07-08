"""ARQ cron: diff provider-side call/message records against local tables.

This is the net under the one failure mode nobody can log at the time it happens:
a Jambonz/Telnyx webhook that never reaches Carameli (ngrok tunnel down, machine
asleep, transient outage). Periodically we ask the providers what happened and diff
against ``call_events`` / ``sms_messages``; anything the provider recorded that
Carameli never did is logged at ERROR with enough identifiers for a coding agent to
act on.

Detection only — we never auto-insert missing rows. A synthesised row would guess at
fields the webhook carries and would mask that delivery is broken.

Provider instances live on ``ctx`` (``ctx["engine"]`` / ``ctx["carrier"]``), created
by the worker startup hooks — see ``startup`` / ``shutdown`` below and how
``call_sync.WorkerSettings`` composes them. Providers are consumed only through the
``base.py`` Protocols; no concrete provider module is imported here.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.core.database import async_session_factory
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.sms_message_repo import SmsMessageRepo
from app.services.providers.base import (
    CallEngineProvider,
    CarrierProvider,
    ProviderCallRecord,
    ProviderMessageRecord,
)

logger = logging.getLogger(__name__)

# A provider record younger than this may just be a webhook still in flight; skip it.
_GRACE_MINUTES = 5


async def startup(ctx: dict) -> None:
    """Instantiate the carrier provider once at ARQ worker startup for reconciliation.

    Stored on ``ctx["carrier"]`` (the engine is set up by ``agent_status_sync.startup``);
    no concrete provider module is imported here.
    """
    from app.services.providers.factory import get_carrier_provider

    ctx["carrier"] = get_carrier_provider()
    logger.info("ARQ worker: carrier provider initialised for reconciliation")


async def shutdown(ctx: dict) -> None:
    """Release the carrier provider's HTTP connection pool on worker exit."""
    carrier = ctx.get("carrier")
    if carrier is not None and hasattr(carrier, "aclose"):
        await carrier.aclose()
    logger.info("ARQ worker: carrier provider closed")


def _within_grace(when: datetime | None, grace_cutoff: datetime) -> bool:
    """True if ``when`` is newer than the grace cutoff (webhook may still be in flight)."""
    if when is None:
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return when > grace_cutoff


async def reconcile_provider_records(ctx: dict) -> None:
    """Diff recent provider call/message records against local tables; log the gaps.

    Gated behind ``settings.reconciliation_enabled`` (default off). Each provider is
    diffed independently so one provider's failure can never kill the other's diff.
    """
    if not settings.reconciliation_enabled:
        return

    now = datetime.now(UTC)
    since = now - timedelta(minutes=settings.reconciliation_lookback_minutes)
    grace_cutoff = now - timedelta(minutes=_GRACE_MINUTES)

    await _reconcile_calls(ctx.get("engine"), since, grace_cutoff)
    await _reconcile_messages(ctx.get("carrier"), since, grace_cutoff)


async def _reconcile_calls(
    engine: CallEngineProvider | None,
    since: datetime,
    grace_cutoff: datetime,
) -> None:
    if engine is None:
        logger.error("reconcile_provider_records: ctx['engine'] not set; skipping call diff")
        return

    try:
        records = await engine.list_recent_calls(since)
    except Exception:
        logger.exception("Reconciliation: call engine list_recent_calls failed; skipping call diff")
        return

    if not records:
        return  # empty window — stay silent to avoid log noise

    candidates: list[ProviderCallRecord] = [
        r for r in records if r.call_sid and not _within_grace(r.started_at, grace_cutoff)
    ]

    async with async_session_factory() as session:
        repo = CallEventRepo(session)
        existing = await repo.get_existing_call_sids([r.call_sid for r in candidates])

    missing = [r for r in candidates if r.call_sid not in existing]
    for rec in missing:
        logger.error(
            "Reconciliation: provider call %s (%s -> %s, started %s, status %s) "
            "has no call_events row",
            rec.call_sid,
            rec.from_number,
            rec.to_number,
            rec.started_at,
            rec.status,
        )

    logger.info(
        "Reconciliation: checked %d provider calls, %d missing locally",
        len(candidates),
        len(missing),
    )


async def _reconcile_messages(
    carrier: CarrierProvider | None,
    since: datetime,
    grace_cutoff: datetime,
) -> None:
    if carrier is None:
        logger.error("reconcile_provider_records: ctx['carrier'] not set; skipping message diff")
        return

    try:
        records = await carrier.list_recent_messages(since)
    except Exception:
        logger.exception(
            "Reconciliation: carrier list_recent_messages failed; skipping message diff"
        )
        return

    if not records:
        return  # empty window — stay silent to avoid log noise

    candidates: list[ProviderMessageRecord] = [
        r for r in records if r.message_sid and not _within_grace(r.created_at, grace_cutoff)
    ]

    async with async_session_factory() as session:
        repo = SmsMessageRepo(session)
        existing = await repo.get_existing_message_sids([r.message_sid for r in candidates])

    missing = [r for r in candidates if r.message_sid not in existing]
    for rec in missing:
        logger.error(
            "Reconciliation: provider message %s (%s -> %s, created %s, status %s) "
            "has no sms_messages row",
            rec.message_sid,
            rec.from_number,
            rec.to_number,
            rec.created_at,
            rec.status,
        )

    logger.info(
        "Reconciliation: checked %d provider messages, %d missing locally",
        len(candidates),
        len(missing),
    )
