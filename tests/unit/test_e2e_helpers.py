"""Unit coverage for the pure parts of the live-E2E helpers.

This is the same-commit test coverage for phase 05: the live suite itself costs money
and needs live infrastructure, but its debuggable primitives (``poll_until`` timeout
message, ``LogTail`` offset reading, log parsing, env-config resolution, skip guard)
are pure and must not regress. No live env, no DB — runs in the default suite.
"""

from __future__ import annotations

import pytest

from tests.live_e2e.helpers import (
    REQUIRED_ENV,
    CarameliClient,
    E2EConfig,
    LogCapture,
    LogTail,
    error_lines,
    lines_containing,
    live_e2e_skip_reason,
    parse_level,
    poll_until,
)

# asyncio_mode=auto (pytest.ini) auto-collects the coroutine tests; no module mark
# needed, and adding one would spuriously flag the sync tests here.


# ---------------------------------------------------------------------------
# poll_until
# ---------------------------------------------------------------------------


async def test_poll_until_returns_first_satisfying_value() -> None:
    """Returns immediately when the predicate holds on the first observation."""
    result = await poll_until(_const(7), lambda v: v == 7, timeout_s=1, interval_s=0.01)
    assert result == 7


async def test_poll_until_polls_until_satisfied() -> None:
    """Keeps polling until the predicate holds, returning the satisfying value."""
    counter = {"n": 0}

    async def observe() -> int:
        counter["n"] += 1
        return counter["n"]

    result = await poll_until(observe, lambda v: v == 3, timeout_s=1, interval_s=0.001)
    assert result == 3
    assert counter["n"] == 3


async def test_poll_until_timeout_message_embeds_last_value() -> None:
    """On timeout the message carries the last observed value so it's debuggable."""

    async def observe() -> dict[str, object]:
        return {"sid": "MSG123", "posted": False}

    with pytest.raises(TimeoutError) as excinfo:
        await poll_until(
            observe,
            lambda v: bool(v["posted"]),
            timeout_s=0.02,
            interval_s=0.001,
            description="sms MSG123 posted",
        )
    message = str(excinfo.value)
    assert "sms MSG123 posted" in message
    assert "MSG123" in message
    assert "posted" in message


# ---------------------------------------------------------------------------
# Log parsing
# ---------------------------------------------------------------------------

_LOG = (
    "2026-07-07 10:00:00.100 | INFO     | app.services.x:12 | started\n"
    "2026-07-07 10:00:01.200 | ERROR    | app.services.x:34 | VanillaSoft notify POST returned 500\n"
    "2026-07-07 10:00:02.300 | WARNING  | app.services.x:56 | soft warning\n"
    "2026-07-07 10:00:03.400 | CRITICAL | app.services.x:78 | boom\n"
    "a line with no pipes at all\n"
)


def test_parse_level_extracts_level() -> None:
    assert parse_level(_LOG.splitlines()[1]) == "ERROR"
    assert parse_level(_LOG.splitlines()[0]) == "INFO"


def test_parse_level_returns_none_for_unstructured_line() -> None:
    assert parse_level("a line with no pipes at all") is None


def test_error_lines_selects_error_and_critical() -> None:
    lines = error_lines(_LOG)
    assert len(lines) == 2
    assert "notify POST returned 500" in lines[0]
    assert "boom" in lines[1]


def test_lines_containing_filters_by_substring() -> None:
    hits = lines_containing(_LOG, "notify POST returned")
    assert len(hits) == 1
    assert "500" in hits[0]


# ---------------------------------------------------------------------------
# LogTail / LogCapture offset reading
# ---------------------------------------------------------------------------


def test_log_tail_reads_only_appended_content(tmp_path) -> None:
    """at_end captures the current size; read_new returns only what's since appended."""
    log = tmp_path / "carameli.log"
    log.write_text("old content already here\n", encoding="utf-8")

    tail = LogTail.at_end(log)
    assert tail.read_new() == ""  # nothing new yet

    with log.open("a", encoding="utf-8") as fh:
        fh.write("new line one\n")
    # splitlines() is newline-agnostic (Windows text mode writes \r\n).
    assert tail.read_new().splitlines() == ["new line one"]
    assert tail.read_new() == ""  # offset advanced; no double-read


def test_log_tail_missing_file_returns_empty(tmp_path) -> None:
    tail = LogTail.at_end(tmp_path / "absent.log")
    assert tail.offset == 0
    assert tail.read_new() == ""


def test_log_tail_handles_rotation(tmp_path) -> None:
    """A file that shrank below the offset restarts from the beginning."""
    log = tmp_path / "carameli.log"
    log.write_text("first big content block\n", encoding="utf-8")
    tail = LogTail.at_end(log)

    log.write_text("small\n", encoding="utf-8")  # truncated/rotated
    assert tail.read_new().splitlines() == ["small"]


def test_log_capture_accumulates_across_refreshes(tmp_path) -> None:
    """LogCapture keeps earlier lines that a destructive read_new would have dropped."""
    log = tmp_path / "carameli.log"
    log.write_text("", encoding="utf-8")
    capture = LogCapture(LogTail.at_end(log))

    with log.open("a", encoding="utf-8") as fh:
        fh.write("2026-07-07 10:00:00.000 | ERROR    | m:1 | boom one\n")
    capture.refresh()
    with log.open("a", encoding="utf-8") as fh:
        fh.write("2026-07-07 10:00:01.000 | INFO     | m:2 | ok\n")
    capture.refresh()

    assert "boom one" in capture.text
    assert "ok" in capture.text
    assert capture.contains("boom one")
    assert len(capture.error_lines()) == 1


# ---------------------------------------------------------------------------
# E2EConfig.from_env / live_e2e_skip_reason
# ---------------------------------------------------------------------------


def test_from_env_none_when_incomplete(monkeypatch) -> None:
    for name in REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("E2E_BASE_URL", "http://localhost:8000")  # only one set
    assert E2EConfig.from_env() is None


def test_from_env_builds_config(monkeypatch) -> None:
    monkeypatch.setenv("E2E_BASE_URL", "http://localhost:8000/")
    monkeypatch.setenv("E2E_API_KEY", "secret")
    monkeypatch.setenv("E2E_CUSTOMER_ID", "4242")
    monkeypatch.setenv("E2E_DID_A", "+15145550001")
    monkeypatch.setenv("E2E_DID_B", "+15145550002")
    monkeypatch.setenv("E2E_VS_CHECK", "1")
    monkeypatch.delenv("E2E_TELNYX_CONNECTION_ID", raising=False)

    cfg = E2EConfig.from_env()
    assert cfg is not None
    assert cfg.base_url == "http://localhost:8000"  # trailing slash stripped
    assert cfg.customer_id == 4242
    assert cfg.vs_check is True
    assert cfg.telnyx_connection_id is None


def test_from_env_none_on_bad_customer_id(monkeypatch) -> None:
    monkeypatch.setenv("E2E_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("E2E_API_KEY", "secret")
    monkeypatch.setenv("E2E_CUSTOMER_ID", "not-an-int")
    monkeypatch.setenv("E2E_DID_A", "+15145550001")
    monkeypatch.setenv("E2E_DID_B", "+15145550002")
    assert E2EConfig.from_env() is None


def test_skip_reason_when_flag_unset(monkeypatch) -> None:
    monkeypatch.delenv("RUN_LIVE_E2E", raising=False)
    reason = live_e2e_skip_reason()
    assert reason is not None
    assert "RUN_LIVE_E2E" in reason


def test_skip_reason_lists_missing_vars(monkeypatch) -> None:
    monkeypatch.setenv("RUN_LIVE_E2E", "1")
    for name in REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    reason = live_e2e_skip_reason()
    assert reason is not None
    assert "E2E_BASE_URL" in reason


def test_skip_reason_none_when_fully_configured(monkeypatch) -> None:
    monkeypatch.setenv("RUN_LIVE_E2E", "1")
    monkeypatch.setenv("E2E_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("E2E_API_KEY", "secret")
    monkeypatch.setenv("E2E_CUSTOMER_ID", "1")
    monkeypatch.setenv("E2E_DID_A", "+15145550001")
    monkeypatch.setenv("E2E_DID_B", "+15145550002")
    assert live_e2e_skip_reason() is None


# ---------------------------------------------------------------------------
# CarameliClient wiring (no network — just the auth header + close)
# ---------------------------------------------------------------------------


async def test_client_sets_bearer_header_and_closes() -> None:
    client = CarameliClient("http://localhost:8000", "topsecret")
    try:
        assert client._client.headers["authorization"] == "Bearer topsecret"
    finally:
        await client.aclose()


def _const(value):
    async def observe():
        return value

    return observe
