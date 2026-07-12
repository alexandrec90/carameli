"""Live E2E — inbound call (and its origination) through the real stack.

For an unattended run we originate a call **via the Telnyx API directly** (not the
Telnyx SDK) from DID A to DID B. B's inbound routing (jambonz app → Carameli webhooks)
fires, producing a real inbound ``call_events`` row. We let it ring, hang up via the
API, then poll Carameli for the row reaching a terminal status with ``posted=True`` —
which, with the honest receiver, means VanillaSoft durably processed it.

The true click-to-call path (``Callback/ByExtension``) needs a human to answer, so it
lives here behind ``@pytest.mark.manual`` for attended runs.
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime

import httpx
import pytest

from app.core.config import settings
from app.core.constants import TELNYX_API_BASE_URL
from tests.live_e2e.helpers import CarameliClient, E2EConfig, live_e2e_skip_reason, poll_until

_SKIP = live_e2e_skip_reason()
pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.paid,
    pytest.mark.live_e2e,
    pytest.mark.skipif(_SKIP is not None, reason=_SKIP or ""),
]

_TERMINAL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}
_RING_SECONDS = 10


def _parse_dt(value: str | None) -> datetime | None:
    """Parse an API ISO timestamp to an aware UTC datetime, or None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


async def _telnyx_originate(connection_id: str, from_: str, to: str) -> str:
    """Originate a call via Telnyx Call Control; return the call_control_id."""
    async with httpx.AsyncClient(
        base_url=TELNYX_API_BASE_URL,
        headers={"Authorization": f"Bearer {settings.telnyx_api_key}"},
        timeout=30,
    ) as client:
        resp = await client.post(
            "/calls",
            json={"connection_id": connection_id, "to": to, "from": from_},
        )
        resp.raise_for_status()
        return resp.json()["data"]["call_control_id"]


async def _telnyx_hangup(call_control_id: str) -> None:
    """Hang up a Telnyx Call Control call; tolerate a 4xx if it already ended."""
    async with httpx.AsyncClient(
        base_url=TELNYX_API_BASE_URL,
        headers={"Authorization": f"Bearer {settings.telnyx_api_key}"},
        timeout=30,
    ) as client:
        resp = await client.post(f"/calls/{call_control_id}/actions/hangup")
        if resp.status_code >= 500:
            resp.raise_for_status()


async def test_inbound_call_posts(live_client: CarameliClient, live_config: E2EConfig) -> None:
    """Originate A→B via Telnyx; the inbound call_events row lands and posts to VS."""
    if not live_config.telnyx_connection_id:
        pytest.skip("Set E2E_TELNYX_CONNECTION_ID to originate calls unattended")
    if not settings.telnyx_api_key:
        pytest.skip("TELNYX_API_KEY not set")

    started_after = datetime.now(UTC)
    call_control_id = await _telnyx_originate(
        live_config.telnyx_connection_id, live_config.did_a, live_config.did_b
    )
    try:
        # Let it ring so jambonz routes the inbound leg and fires the status webhook.
        await asyncio.sleep(_RING_SECONDS)
    finally:
        await _telnyx_hangup(call_control_id)

    async def inbound_row() -> dict | None:
        rows = await live_client.list_calls(live_config.customer_id, limit=200)
        for r in rows:
            started = _parse_dt(r.get("started_at"))
            if (
                r.get("direction") == "inbound"
                and r.get("to_number") == live_config.did_b
                and started is not None
                and started >= started_after
            ):
                return r
        return None

    row = await poll_until(
        inbound_row,
        lambda r: r is not None and r.get("status") in _TERMINAL_STATUSES and bool(r.get("posted")),
        timeout_s=120,
        interval_s=5,
        description=f"inbound call to={live_config.did_b} terminal+posted",
    )
    assert row is not None
    assert row["status"] in _TERMINAL_STATUSES
    assert row["posted"] is True


@pytest.mark.manual
async def test_click_to_call_attended(live_client: CarameliClient, live_config: E2EConfig) -> None:
    """Attended click-to-call via Callback/ByExtension — a human must answer the agent leg."""
    extension = os.getenv("E2E_EXTENSION")
    if not extension:
        pytest.skip("Set E2E_EXTENSION (and answer the phone) to run the attended variant")

    started_after = datetime.now(UTC)
    resp = await live_client.post(
        "/vsapi/1.0.0/Callback/ByExtension",
        json={
            "vs_customer_id": live_config.customer_id,
            "extension": extension,
            "destination_number": live_config.did_b,
        },
    )
    assert resp.status_code == 200, resp.text

    async def terminal_row() -> dict | None:
        rows = await live_client.list_calls(live_config.customer_id, limit=200)
        for r in rows:
            started = _parse_dt(r.get("started_at"))
            if started is not None and started >= started_after and r.get("posted"):
                return r
        return None

    row = await poll_until(
        terminal_row,
        lambda r: r is not None,
        timeout_s=180,
        interval_s=5,
        description="attended callback call posted",
    )
    assert row is not None
