"""Pure helpers + thin API/log wrappers for the live E2E suite.

The live suite (``tests/live_e2e/test_live_*.py``) drives the *real* integration —
real Telnyx, jambonz.cloud, ngrok, and the VanillaSoft staging server — and observes
the live running stack from the outside. It never uses the unit/integration DB
fixtures: all assertions go through Carameli's HTTP API and, for signals the API does
not expose (e.g. SMS ``posted``), the runtime log at ``logs/runtime/carameli.log``.

The pure logic here (``poll_until`` timeout/last-value message, ``LogTail`` offset
reading, ``E2EConfig.from_env``, ``live_e2e_skip_reason``) is unit-tested in
``tests/unit/test_e2e_helpers.py`` so this phase carries same-commit coverage even
when nobody runs the (money-costing) live suite.

Environment contract (see also ``.env.example`` and ``docs/diagnostics-error-map.md``):

| Var                      | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------ |
| ``RUN_LIVE_E2E``         | ``1`` to enable the suite (otherwise every test skips)       |
| ``E2E_BASE_URL``         | Carameli public base (the ngrok URL) or ``http://localhost:8000`` |
| ``E2E_API_KEY``          | Bearer key for a dedicated E2E test customer                 |
| ``E2E_CUSTOMER_ID``      | That customer's ``vs_customer_id`` (needed for ``/List/{id}`` reads) |
| ``E2E_DID_A``            | Owned Canadian test DID — the "from" number                  |
| ``E2E_DID_B``            | Owned Canadian test DID — the "inbound" target               |
| ``E2E_VS_CHECK``         | optional ``1``: also assert VanillaSoft-side via PubApi       |
| ``E2E_TELNYX_CONNECTION_ID`` | optional: Telnyx Call Control connection for unattended call origination |
| ``E2E_RECORDING``        | optional ``1``: run the recording flow (roadmap A6 must be live) |
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

VSAPI_PREFIX = "/vsapi/1.0.0"

# Env vars required for the live suite to run (in addition to RUN_LIVE_E2E=1).
REQUIRED_ENV = ("E2E_BASE_URL", "E2E_API_KEY", "E2E_CUSTOMER_ID", "E2E_DID_A", "E2E_DID_B")


def live_e2e_skip_reason() -> str | None:
    """Return a human-readable skip reason if the live suite can't run, else ``None``.

    The suite is opt-in and needs live infrastructure and real money, so it stays
    skipped unless ``RUN_LIVE_E2E=1`` *and* every required env var is set.
    """
    if os.getenv("RUN_LIVE_E2E") != "1":
        return "Set RUN_LIVE_E2E=1 to run the live E2E suite (costs real money)"
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        return "Live E2E requires env vars: " + ", ".join(missing)
    return None


@dataclass(frozen=True)
class E2EConfig:
    """Live-suite configuration resolved from the ``E2E_*`` environment."""

    base_url: str
    api_key: str
    customer_id: int
    did_a: str
    did_b: str
    vs_check: bool
    telnyx_connection_id: str | None

    @classmethod
    def from_env(cls) -> E2EConfig | None:
        """Build config from ``E2E_*`` env vars; ``None`` if a required one is missing.

        ``E2E_CUSTOMER_ID`` must be a valid integer — a malformed value returns ``None``
        rather than raising, so collection never explodes on a typo.
        """
        base_url = os.getenv("E2E_BASE_URL")
        api_key = os.getenv("E2E_API_KEY")
        raw_customer_id = os.getenv("E2E_CUSTOMER_ID")
        did_a = os.getenv("E2E_DID_A")
        did_b = os.getenv("E2E_DID_B")
        if not (base_url and api_key and raw_customer_id and did_a and did_b):
            return None
        try:
            customer_id = int(raw_customer_id)
        except ValueError:
            return None
        return cls(
            base_url=base_url.rstrip("/"),
            api_key=api_key,
            customer_id=customer_id,
            did_a=did_a,
            did_b=did_b,
            vs_check=os.getenv("E2E_VS_CHECK") == "1",
            telnyx_connection_id=os.getenv("E2E_TELNYX_CONNECTION_ID") or None,
        )


async def poll_until[T](
    observe: Callable[[], Awaitable[T]],
    predicate: Callable[[T], bool] = bool,
    *,
    timeout_s: float = 90,
    interval_s: float = 3,
    description: str = "condition",
) -> T:
    """Poll ``observe()`` until ``predicate(result)`` is true; return that result.

    Raises ``TimeoutError`` after ``timeout_s`` whose message embeds the *last observed
    value* — that message is what a human or agent debugs from, so it must show *why*
    the wait never satisfied (e.g. the row is present but ``posted=False``). The
    default ``predicate`` is ``bool``, i.e. "poll until the result is truthy".
    """
    deadline = time.monotonic() + timeout_s
    last = await observe()
    while not predicate(last):
        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"poll_until({description}) timed out after {timeout_s}s; "
                f"last observed value: {last!r}"
            )
        await asyncio.sleep(interval_s)
        last = await observe()
    return last


# ---------------------------------------------------------------------------
# Log tailing — the suite runs on the same machine as the stack, so it can read
# carameli.log directly to assert "no new ERROR lines during this test" and to
# find vs.-shipped (phase 03) entries the HTTP API never exposes.
# ---------------------------------------------------------------------------


def parse_level(line: str) -> str | None:
    """Extract the level field from a formatted log line, or ``None`` if unparseable.

    Format (see ``app/core/logging_config.py``)::

        2026-02-21 14:30:00.123 | ERROR    | app.module:56 | message text
    """
    parts = line.split(" | ")
    if len(parts) < 3:
        return None
    return parts[1].strip()


def error_lines(text: str) -> list[str]:
    """Return the ERROR/CRITICAL lines within a block of log text."""
    return [ln for ln in text.splitlines() if parse_level(ln) in ("ERROR", "CRITICAL")]


def lines_containing(text: str, needle: str) -> list[str]:
    """Return the lines within a block of log text that contain ``needle``."""
    return [ln for ln in text.splitlines() if needle in ln]


@dataclass
class LogTail:
    """Reads content appended to a log file since a captured byte offset.

    Byte offsets (binary reads) are used rather than text-mode ``seek`` so Windows
    newline translation can't corrupt the offset accounting.
    """

    path: Path
    offset: int = 0

    @classmethod
    def at_end(cls, path: str | Path) -> LogTail:
        """Capture the current end-of-file as the starting offset (0 if the file is absent)."""
        p = Path(path)
        offset = p.stat().st_size if p.exists() else 0
        return cls(path=p, offset=offset)

    def read_new(self) -> str:
        """Return text appended since the last read and advance the offset.

        If the file shrank (rotation/truncation) below the offset, restart from the
        beginning so a mid-test rotation doesn't silently swallow new lines.
        """
        if not self.path.exists():
            return ""
        with self.path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            start = self.offset if self.offset <= size else 0
            fh.seek(start)
            data = fh.read()
        self.offset = start + len(data)
        return data.decode("utf-8", errors="replace")


class LogCapture:
    """Accumulates all new log content across polls for a single test.

    ``LogTail.read_new`` is destructive (it advances the offset), so polling the log
    repeatedly would drop earlier lines. ``LogCapture`` keeps the running text so a
    test can poll for one signal and still assert over everything seen so far.
    """

    def __init__(self, tail: LogTail) -> None:
        self._tail = tail
        self._text = ""

    def refresh(self) -> str:
        """Append any newly-written content and return the full accumulated text."""
        self._text += self._tail.read_new()
        return self._text

    @property
    def text(self) -> str:
        """All content accumulated so far (does not read the file)."""
        return self._text

    def error_lines(self) -> list[str]:
        """ERROR/CRITICAL lines seen so far (refreshes first)."""
        return error_lines(self.refresh())

    def contains(self, needle: str) -> bool:
        """True if ``needle`` appears anywhere in the content seen so far (refreshes first)."""
        return needle in self.refresh()


# ---------------------------------------------------------------------------
# Thin authed HTTP client over Carameli's vsapi surface (live suite only).
# ---------------------------------------------------------------------------


class CarameliClient:
    """A minimal authed ``httpx.AsyncClient`` wrapper for Carameli's read/write API."""

    def __init__(self, base_url: str, api_key: str, *, timeout: float = 30) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_sms(
        self, customer_id: int, from_: str, to: str, body: str
    ) -> httpx.Response:
        """POST an outbound SMS via VsMessaging/Sms/Send."""
        return await self._client.post(
            f"{VSAPI_PREFIX}/VsMessaging/Sms/Send/{customer_id}",
            json={"from_number": from_, "to_number": to, "body": body},
        )

    async def list_sms(self, customer_id: int, *, limit: int = 100) -> list[dict[str, Any]]:
        """Return the customer's SMS message rows, newest first."""
        resp = await self._client.get(
            f"{VSAPI_PREFIX}/VsMessaging/Sms/List/{customer_id}",
            params={"limit": limit},
        )
        resp.raise_for_status()
        messages: list[dict[str, Any]] = resp.json()["messages"]
        return messages

    async def list_calls(self, customer_id: int, *, limit: int = 100) -> list[dict[str, Any]]:
        """Return the customer's call-event rows, newest first."""
        resp = await self._client.get(
            f"{VSAPI_PREFIX}/VsCall/List/{customer_id}",
            params={"limit": limit},
        )
        resp.raise_for_status()
        events: list[dict[str, Any]] = resp.json()["events"]
        return events

    async def get_recording(self, call_sid: str) -> httpx.Response:
        """GET the recording metadata for a call by CallSid (raw response for status checks)."""
        return await self._client.get(f"{VSAPI_PREFIX}/VsCall/Recording/{call_sid}")

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        """Passthrough GET for anything the typed helpers don't cover (e.g. served media)."""
        return await self._client.get(url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        """Passthrough POST for anything the typed helpers don't cover (e.g. Callback)."""
        return await self._client.post(url, **kwargs)
