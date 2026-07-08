"""Live E2E — call recording pipeline (roadmap A6).

Only meaningful once the recording pipeline (record → S3 → Carameli-served URL) is
live. Rather than silently omit the file, the whole module skips with a tracking
reason unless ``E2E_RECORDING=1`` — the skip *is* the tracking that A6 hasn't been
verified end-to-end here yet.

Flow: originate a recorded call → poll the call row for ``recording_url`` → GET the
Carameli-served URL (expect 200, ``audio/*``) → assert the CallRecording notify
reached VanillaSoft.
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime

import pytest

from app.core.config import settings
from tests.live_e2e.helpers import (
    CarameliClient,
    E2EConfig,
    LogCapture,
    live_e2e_skip_reason,
    poll_until,
)
from tests.live_e2e.test_live_call import _parse_dt, _telnyx_hangup, _telnyx_originate

_SKIP = live_e2e_skip_reason()
pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.live_e2e,
    pytest.mark.skipif(_SKIP is not None, reason=_SKIP or ""),
    pytest.mark.skipif(
        os.getenv("E2E_RECORDING") != "1",
        reason="A6 recording pipeline not verified live — set E2E_RECORDING=1 once it lands",
    ),
]

_RING_SECONDS = 12


async def test_recorded_call_served_and_notified(
    live_client: CarameliClient,
    live_config: E2EConfig,
    log_capture: LogCapture,
) -> None:
    """A recorded call exposes a playable recording URL and notifies VanillaSoft."""
    if not live_config.telnyx_connection_id:
        pytest.skip("Set E2E_TELNYX_CONNECTION_ID to originate a recorded call")
    if not settings.telnyx_api_key:
        pytest.skip("TELNYX_API_KEY not set")

    started_after = datetime.now(UTC)
    call_control_id = await _telnyx_originate(
        live_config.telnyx_connection_id, live_config.did_a, live_config.did_b
    )
    try:
        await asyncio.sleep(_RING_SECONDS)
    finally:
        await _telnyx_hangup(call_control_id)

    # Poll the call row until a recording URL is attached.
    async def recorded_row() -> dict | None:
        rows = await live_client.list_calls(live_config.customer_id, limit=200)
        for r in rows:
            started = _parse_dt(r.get("started_at"))
            if (
                r.get("to_number") == live_config.did_b
                and started is not None
                and started >= started_after
                and r.get("recording_url")
            ):
                return r
        return None

    row = await poll_until(
        recorded_row,
        lambda r: r is not None,
        timeout_s=180,
        interval_s=5,
        description=f"call row with recording_url to={live_config.did_b}",
    )
    assert row is not None
    call_sid = row["call_sid"]

    # The recording endpoint returns a Carameli-served URL; fetch it and expect audio.
    meta = await live_client.get_recording(call_sid)
    assert meta.status_code == 200, meta.text
    served_url = meta.json()["recording_url"]

    audio = await live_client.get(served_url)
    assert audio.status_code == 200, audio.text
    assert audio.headers.get("content-type", "").startswith("audio/"), audio.headers

    # The CallRecording notify must have reached VanillaSoft.
    await poll_until(
        lambda: _contains(log_capture, "notify POST ok", "path=CallRecording"),
        timeout_s=120,
        interval_s=5,
        description=f"CallRecording notify ok call_sid={call_sid}",
    )


async def _contains(capture: LogCapture, *needles: str) -> bool:
    """True once a single log line contains all of ``needles`` (refreshes the capture)."""
    return any(all(n in line for n in needles) for line in capture.refresh().splitlines())
