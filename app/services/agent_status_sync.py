"""ARQ cron job: poll Jambonz every 30 s for per-agent call state + SIP registration.

Design note — provider lifecycle
---------------------------------
The JambonzEngine wraps an httpx.AsyncClient that must be created once and
reused (not instantiated per poll).  We use ARQ's ``on_startup`` /
``on_shutdown`` hooks to manage the lifecycle:

  startup()   → instantiates the engine via factory.get_call_engine_provider()
                and stores it in ctx["engine"]
  poll_agent_status() → reads ctx["engine"] (no direct import of jambonz.py)
  shutdown()  → calls engine.aclose() to drain the httpx connection pool

This satisfies the guardrail: jambonz.py is never imported directly here.

Clarity API field mapping
--------------------------
VanillaLand polled two Clarity endpoints:
  (a) HUD Phones  → per-agent callState / presence / idle
  (b) Device Status → SIP registration (state == "AUTHENTICATED")

Jambonz equivalents used here:
  (a) GET /v1/Accounts/{sid}/Calls       → active call list (call_state, call_sid)
  (b) GET /v1/Accounts/{sid}/registrations → SIP registration list (sip_registered)

Clarity fields with no Jambonz equivalent (presence/availability set by the
agent themselves) are intentionally omitted; they would always be NULL.
"""

from __future__ import annotations

import logging

from app.core.database import async_session_factory
from app.repositories.agent_status_repo import AgentStatusRepo
from app.repositories.extension_repo import ExtensionRepo

logger = logging.getLogger(__name__)

# Map Jambonz call_status values to the canonical call_state strings stored in DB.
_JAMBONZ_STATE_MAP: dict[str, str] = {
    "trying": "ringing",
    "ringing": "ringing",
    "early": "ringing",
    "in-progress": "on-call",
    "completed": "idle",
    "failed": "idle",
    "busy": "idle",
    "no-answer": "idle",
    "canceled": "idle",
}


def _map_call_status(raw: str) -> str:
    """Normalise a Jambonz call_status string to our canonical call_state."""
    return _JAMBONZ_STATE_MAP.get(raw.lower(), raw.lower())


async def startup(ctx: dict) -> None:
    """Instantiate the call-engine provider once at ARQ worker startup.

    Stores the provider on ``ctx["engine"]`` so cron jobs can use it without
    importing any concrete provider module directly.
    """
    from app.services.providers.factory import get_call_engine_provider

    ctx["engine"] = get_call_engine_provider()
    logger.info("ARQ worker: call engine provider initialised")


async def shutdown(ctx: dict) -> None:
    """Release the call-engine provider's HTTP connection pool on worker exit."""
    engine = ctx.get("engine")
    if engine is not None and hasattr(engine, "aclose"):
        await engine.aclose()
    logger.info("ARQ worker: call engine provider closed")


async def poll_agent_status(ctx: dict) -> None:
    """Fetch Jambonz call state + SIP registrations and upsert agent_statuses.

    One row per SIP username (upsert on conflict).  A failed poll is logged at
    ERROR level but never propagates — the worker must survive a bad poll.
    """
    engine = ctx.get("engine")
    if engine is None:
        logger.error("poll_agent_status: ctx['engine'] not set; skipping poll")
        return

    try:
        active_calls = await engine.get_active_calls()
        registrations = await engine.get_registrations()
    except Exception:
        logger.exception("poll_agent_status: Jambonz API error; skipping this poll")
        return

    # ── Build lookup structures ────────────────────────────────────────────
    # registered_users: set of sip_usernames that have a live SIP registration.
    registered_users: set[str] = {
        r.get("sipUser") or r.get("sip_user") or ""
        for r in registrations
        if r.get("sipUser") or r.get("sip_user")
    }

    # active_call_by_sip: sip_username → {call_state, call_sid}
    # Jambonz returns ``sip_user`` on the call record for SIP-terminated legs.
    active_call_by_sip: dict[str, dict] = {}
    for call in active_calls:
        sip_user: str = call.get("sip_user") or call.get("sipUser") or ""
        if not sip_user:
            continue
        raw_status: str = call.get("call_status") or call.get("status") or "in-progress"
        active_call_by_sip[sip_user] = {
            "call_state": _map_call_status(raw_status),
            "call_sid": call.get("call_sid") or call.get("sid") or None,
        }

    # ── Query all known extensions ─────────────────────────────────────────
    try:
        async with async_session_factory() as session:
            ext_repo = ExtensionRepo(session)
            agent_repo = AgentStatusRepo(session)

            extensions = await ext_repo.get_all_active()
            if not extensions:
                logger.info("poll_agent_status: no active extensions; nothing to upsert")
                return

            rows = []
            for ext in extensions:
                sip_user = ext.sip_username
                call_info = active_call_by_sip.get(sip_user)
                rows.append(
                    {
                        "customer_id": ext.customer_id,
                        "extension_id": ext.id,
                        "sip_username": sip_user,
                        "call_state": call_info["call_state"] if call_info else "idle",
                        "call_sid": call_info["call_sid"] if call_info else None,
                        "sip_registered": sip_user in registered_users,
                    }
                )

            await agent_repo.upsert_batch(rows)

        on_call = sum(1 for r in rows if r["call_state"] == "on-call")
        registered = sum(1 for r in rows if r["sip_registered"])
        logger.info(
            "poll_agent_status: polled %d agents, %d registered, %d on-call",
            len(rows),
            registered,
            on_call,
        )

    except Exception:
        logger.exception("poll_agent_status: DB upsert failed; skipping this poll")
