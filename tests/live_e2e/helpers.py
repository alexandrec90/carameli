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

Environment contract (see also ``.env.example`` and ``docs/operations/diagnostics-error-map.md``):

| Var                      | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------ |
| ``RUN_LIVE_E2E``         | ``1`` to enable the suite (otherwise every test skips)       |
| ``E2E_BASE_URL``         | Carameli public base (the ngrok URL) or ``http://localhost:8000`` |
| ``E2E_API_KEY``          | Bearer key for a dedicated E2E test customer                 |
| ``E2E_CUSTOMER_ID``      | That customer's ``vs_customer_id`` (needed for ``/List/{id}`` reads) |
| ``E2E_DID_A``            | Owned Canadian test DID — the "from" number                  |
| ``E2E_DID_B``            | Owned Canadian test DID — the "inbound" target               |
| ``E2E_VS_CHECK``         | optional ``1``: also assert VanillaSoft-side via PubApi       |
| ``E2E_PUBAPI_BASE_URL``  | required when ``E2E_VS_CHECK=1``: VanillaSoft PubApi root     |
| ``E2E_PUBAPI_KEY``       | required when ``E2E_VS_CHECK=1``: key for ``Authorization: APIKey=`` |
| ``E2E_PUBAPI_PROJECT_ID`` | optional: restrict the PubApi call-history read to one project |
| ``E2E_TELNYX_CONNECTION_ID`` | optional: Telnyx Call Control connection for unattended call origination |
| ``E2E_RECORDING``        | optional ``1``: run the recording flow (roadmap A6 must be live) |

``E2E_VS_CHECK`` is the belt-and-suspenders check: rather than trusting Carameli's own
``posted`` flag, read the call back out of VanillaSoft's ``GetCallHistory`` PubApi
endpoint. **It only applies to the attended click-to-call test**, and the reason is
worth stating because it is not what the phase-05 plan assumed:

*Nothing on the VanillaSoft side creates a call-history record from a Carameli
notification.* ``CarameliNotifyController`` calls ``sp_CMVCallNotificationInsert``,
which writes a CMV *notification* row. The CMV Call Data Service later calls
``sp_CallHistoryCallAttemptInsert`` (``../VanillaLand/AppCode/CMV Call Data
Service/CMVCallData.cs``, ``FindCallAttemptCallHistory``) — and that attaches the
attempt to a call-history record it *found* via
``sp_CMVCallAttemptMatchCallHistoryFetch``. Call-history rows come from the CRM, when
an agent works a contact.

So for the unattended inbound flow — a call originated straight through Telnyx, that no
agent placed from inside VanillaSoft — ``GetCallHistory`` has nothing to return no
matter how staging is seeded, and ``posted=True`` is the only honest VanillaSoft
assertion. For the attended flow the agent *did* dial a contact from the CRM, so the
record exists and the read-back is meaningful.

Its precondition, then, is the ordinary one for that flow: the dialed contact exists in
the E2E project, and PubApi has access to that project. One wrinkle if you seed a
contact by hand — ``FindCallAttemptCallHistory`` strips a leading ``+`` and a leading
``1`` from the *incoming* number only, so store the contact's number in 10-digit form
(``5145550001``, not ``+15145550001``) or the lookup misses.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import httpx

VSAPI_PREFIX = "/vsapi/1.0.0"

# Env vars required for the live suite to run (in addition to RUN_LIVE_E2E=1).
REQUIRED_ENV = ("E2E_BASE_URL", "E2E_API_KEY", "E2E_CUSTOMER_ID", "E2E_DID_A", "E2E_DID_B")

# Required *additionally* when E2E_VS_CHECK=1. Without them the flag would parse into
# config and assert nothing — a silent no-op is the one outcome an opt-in check must
# never have, so a half-configured VS check skips the suite with these names in it.
VS_CHECK_ENV = ("E2E_PUBAPI_BASE_URL", "E2E_PUBAPI_KEY")


def live_e2e_skip_reason() -> str | None:
    """Return a human-readable skip reason if the live suite can't run, else ``None``.

    The suite is opt-in and needs live infrastructure and real money, so it stays
    skipped unless ``RUN_LIVE_E2E=1`` *and* every required env var is set. Opting into
    ``E2E_VS_CHECK`` adds the PubApi credentials to that required set.
    """
    if os.getenv("RUN_LIVE_E2E") != "1":
        return "Set RUN_LIVE_E2E=1 to run the live E2E suite (costs real money)"
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        return "Live E2E requires env vars: " + ", ".join(missing)
    if os.getenv("E2E_VS_CHECK") == "1":
        missing_vs = [name for name in VS_CHECK_ENV if not os.getenv(name)]
        if missing_vs:
            return "E2E_VS_CHECK=1 requires env vars: " + ", ".join(missing_vs)
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
    pubapi_base_url: str | None
    pubapi_key: str | None
    pubapi_project_id: int | None
    telnyx_connection_id: str | None

    @classmethod
    def from_env(cls) -> E2EConfig | None:
        """Build config from ``E2E_*`` env vars; ``None`` if a required one is missing.

        ``E2E_CUSTOMER_ID`` and ``E2E_PUBAPI_PROJECT_ID`` must be valid integers — a
        malformed value returns ``None`` rather than raising, so collection never
        explodes on a typo.
        """
        base_url = os.getenv("E2E_BASE_URL")
        api_key = os.getenv("E2E_API_KEY")
        raw_customer_id = os.getenv("E2E_CUSTOMER_ID")
        did_a = os.getenv("E2E_DID_A")
        did_b = os.getenv("E2E_DID_B")
        raw_project_id = os.getenv("E2E_PUBAPI_PROJECT_ID")
        if not (base_url and api_key and raw_customer_id and did_a and did_b):
            return None
        try:
            customer_id = int(raw_customer_id)
            project_id = int(raw_project_id) if raw_project_id else None
        except ValueError:
            return None
        pubapi_base_url = os.getenv("E2E_PUBAPI_BASE_URL")
        return cls(
            base_url=base_url.rstrip("/"),
            api_key=api_key,
            customer_id=customer_id,
            did_a=did_a,
            did_b=did_b,
            vs_check=os.getenv("E2E_VS_CHECK") == "1",
            pubapi_base_url=pubapi_base_url.rstrip("/") if pubapi_base_url else None,
            pubapi_key=os.getenv("E2E_PUBAPI_KEY") or None,
            pubapi_project_id=project_id,
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

    async def send_sms(self, customer_id: int, from_: str, to: str, body: str) -> httpx.Response:
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


# ---------------------------------------------------------------------------
# VanillaSoft PubApi — the E2E_VS_CHECK read-back (see the module docstring).
# ---------------------------------------------------------------------------

# PubApi's DateRangeValidation caps GetCallHistory at a 7-day span; the E2E window is
# minutes wide, so the cap never binds. The margin absorbs clock skew between this
# machine and the VanillaSoft staging server.
PUBAPI_CLOCK_SKEW_MINUTES = 5


def pubapi_datetime(value: datetime) -> str:
    """Format a datetime as PubApi's ``yyyy-MM-ddTHH:mm:ss`` UTC string.

    PubApi binds the value as a naive ``DateTime`` and only converts it when the string
    carries a zone, so an aware value is converted to UTC and the zone dropped here —
    sending ``+00:00`` would round-trip through local time on the server.
    """
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%S")


def pubapi_call_history_query(
    start: datetime,
    end: datetime,
    *,
    limit: int = 1000,
    project_id: int | None = None,
) -> str:
    """Build the ``GetCallHistory`` query string.

    The colons in the timestamps are percent-encoded (``%3A``) as PubApi's own
    documentation requires; ``urlencode``'s default quoting would leave them bare.
    """
    params = {
        "start": pubapi_datetime(start),
        "end": pubapi_datetime(end),
        "limit": str(limit),
    }
    if project_id is not None:
        params["project_id"] = str(project_id)
    return urlencode(params, quote_via=quote)


def call_histories_since(rows: list[dict[str, Any]], since: datetime) -> list[dict[str, Any]]:
    """Return the call-history rows whose ``call_date_time_utc`` is at or after ``since``.

    ``GetCallHistory`` filters on *modified* time, so a record touched during the window
    but placed long before it comes back too. This narrows to calls actually made in the
    window. Rows with an absent or unparseable timestamp are dropped rather than kept —
    a record we cannot date is not evidence that *this* call reached VanillaSoft.
    """
    if since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    kept = []
    for row in rows:
        raw = row.get("call_date_time_utc")
        if not isinstance(raw, str):
            continue
        try:
            when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if when >= since:
            kept.append(row)
    return kept


class PubApiClient:
    """A minimal authed client for VanillaSoft's PubApi read endpoints.

    PubApi authenticates with ``Authorization: APIKey=<key>`` — not ``Bearer`` — per
    ``ApiKeyUtil.GetApiKeyFromHeaders`` in the VanillaLand repo.
    """

    def __init__(self, base_url: str, api_key: str, *, timeout: float = 30) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"APIKey={api_key}"},
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get_call_history(
        self,
        start: datetime,
        end: datetime,
        *,
        limit: int = 1000,
        project_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return the ``call_histories`` array for calls modified in ``[start, end]``."""
        resp = await self._client.get(
            f"/GetCallHistory?{pubapi_call_history_query(start, end, limit=limit, project_id=project_id)}"
        )
        resp.raise_for_status()
        histories: list[dict[str, Any]] | None = resp.json().get("call_histories")
        return histories or []
