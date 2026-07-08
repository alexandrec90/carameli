"""Live E2E — SMS round-trip (outbound + inbound from a single real send).

One real SMS from DID A to DID B exercises *both* directions: it is A's outbound and
B's inbound. We never send twice. See ``helpers.py`` for the env contract and
``docs/diagnostics-error-map.md`` for how to run and what it costs.

The airtight assertion is the notify log line: with the honest receiver (phase 02) a
logged "notify POST ok" means VanillaSoft *durably processed* the event — that's the
loop-closing signal. ``posted`` is exposed on call events but not on SMS rows, so for
SMS the runtime log is the mechanism.
"""

from __future__ import annotations

import uuid

import pytest

from tests.live_e2e.helpers import (
    CarameliClient,
    E2EConfig,
    LogCapture,
    live_e2e_skip_reason,
    poll_until,
)

_SKIP = live_e2e_skip_reason()
pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.live_e2e,
    pytest.mark.skipif(_SKIP is not None, reason=_SKIP or ""),
]


def _notify_ok(capture: LogCapture, path_token: str) -> bool:
    """True once a 'notify POST ok' line for exactly ``path_token`` has been logged.

    Matches the end of the line so ``IncomingSmsMessage`` is not confused with
    ``IncomingSmsMessageDeliveryReceipt`` (one is a suffix of the other).
    """
    for line in capture.refresh().splitlines():
        stripped = line.rstrip()
        if "notify POST ok" in stripped and stripped.endswith("path=" + path_token):
            return True
    return False


async def test_sms_round_trip(
    live_client: CarameliClient,
    live_config: E2EConfig,
    log_capture: LogCapture,
) -> None:
    """Send A→B once; assert the outbound + inbound rows land and both notify VS."""
    marker = uuid.uuid4().hex[:12]
    body = f"Carameli live E2E {marker}"

    resp = await live_client.send_sms(
        live_config.customer_id, live_config.did_a, live_config.did_b, body
    )
    assert resp.status_code == 200, resp.text
    message_sid = resp.json()["message_sid"]
    assert message_sid, "Send returned no message_sid"

    # 1. Outbound row is persisted synchronously by the Send handler.
    async def outbound_row() -> dict | None:
        rows = await live_client.list_sms(live_config.customer_id, limit=200)
        return next((r for r in rows if r.get("message_sid") == message_sid), None)

    row = await poll_until(
        outbound_row,
        lambda r: r is not None,
        timeout_s=60,
        interval_s=3,
        description=f"outbound sms row sid={message_sid}",
    )
    assert row is not None
    assert row["direction"] == "outbound"

    # 2. Delivery receipt is forwarded to VanillaSoft (the outbound VS assertion).
    await poll_until(
        lambda: _return(_notify_ok(log_capture, "IncomingSmsMessageDeliveryReceipt")),
        timeout_s=120,
        interval_s=5,
        description=f"delivery-receipt notify ok sid={message_sid}",
    )

    # 3. The same send is B's inbound message; its row appears with our marker...
    async def inbound_row() -> dict | None:
        rows = await live_client.list_sms(live_config.customer_id, limit=200)
        return next(
            (
                r
                for r in rows
                if r.get("direction") == "inbound"
                and r.get("to_number") == live_config.did_b
                and marker in (r.get("body") or "")
            ),
            None,
        )

    inbound = await poll_until(
        inbound_row,
        lambda r: r is not None,
        timeout_s=90,
        interval_s=3,
        description=f"inbound sms row to={live_config.did_b} marker={marker}",
    )
    assert inbound is not None
    assert inbound["from_number"] == live_config.did_a

    # 4. ...and the inbound message is forwarded to VanillaSoft.
    await poll_until(
        lambda: _return(_notify_ok(log_capture, "IncomingSmsMessage")),
        timeout_s=120,
        interval_s=5,
        description=f"inbound-message notify ok marker={marker}",
    )

    # 5. Airtight negative probe: no unposted-retry / reconciliation ERRORs fired
    #    while VS staging is known-good (flow 6 — non-destructive).
    bad = [
        ln
        for ln in log_capture.error_lines()
        if "notify POST returned" in ln or "Reconciliation:" in ln
    ]
    assert not bad, f"unexpected notify/reconciliation ERROR lines during test: {bad}"


async def _return(value: bool) -> bool:
    """Adapt a synchronous check into the async predicate ``poll_until`` expects."""
    return value
