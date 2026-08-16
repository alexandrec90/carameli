"""Unit coverage for the pure parts of the live-E2E helpers.

This is the same-commit test coverage for phase 05: the live suite itself costs money
and needs live infrastructure, but its debuggable primitives (``poll_until`` timeout
message, ``LogTail`` offset reading, log parsing, env-config resolution, skip guard)
are pure and must not regress. No live env, no DB — runs in the default suite.
"""

from __future__ import annotations

import inspect
from datetime import UTC, datetime
from typing import Any

import pytest

from tests.live_e2e.helpers import (
    REQUIRED_ENV,
    VS_CHECK_ENV,
    CarameliClient,
    E2EConfig,
    LogCapture,
    LogTail,
    PubApiClient,
    call_histories_since,
    error_lines,
    lines_containing,
    live_e2e_skip_reason,
    parse_level,
    poll_until,
    pubapi_call_history_query,
    pubapi_datetime,
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
    for name in (*VS_CHECK_ENV, "E2E_PUBAPI_PROJECT_ID"):
        monkeypatch.delenv(name, raising=False)

    cfg = E2EConfig.from_env()
    assert cfg is not None
    assert cfg.base_url == "http://localhost:8000"  # trailing slash stripped
    assert cfg.customer_id == 4242
    assert cfg.vs_check is True
    assert cfg.telnyx_connection_id is None
    assert cfg.pubapi_base_url is None
    assert cfg.pubapi_key is None
    assert cfg.pubapi_project_id is None


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
    _set_required_env(monkeypatch)
    monkeypatch.delenv("E2E_VS_CHECK", raising=False)
    assert live_e2e_skip_reason() is None


# ---------------------------------------------------------------------------
# E2E_VS_CHECK — the flag must never resolve to "configured but asserts nothing"
# ---------------------------------------------------------------------------


def test_skip_reason_names_missing_pubapi_vars_when_vs_check_on(monkeypatch) -> None:
    """E2E_VS_CHECK=1 without PubApi creds skips loudly instead of no-op'ing."""
    _set_required_env(monkeypatch)
    monkeypatch.setenv("E2E_VS_CHECK", "1")
    for name in VS_CHECK_ENV:
        monkeypatch.delenv(name, raising=False)

    reason = live_e2e_skip_reason()
    assert reason is not None
    assert "E2E_VS_CHECK" in reason
    assert "E2E_PUBAPI_BASE_URL" in reason
    assert "E2E_PUBAPI_KEY" in reason


def test_skip_reason_lists_only_the_missing_pubapi_var(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setenv("E2E_VS_CHECK", "1")
    monkeypatch.setenv("E2E_PUBAPI_BASE_URL", "https://pubapi.example.com")
    monkeypatch.delenv("E2E_PUBAPI_KEY", raising=False)

    reason = live_e2e_skip_reason()
    assert reason is not None
    assert "E2E_PUBAPI_KEY" in reason
    assert "E2E_PUBAPI_BASE_URL" not in reason


def test_skip_reason_none_when_vs_check_fully_configured(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setenv("E2E_VS_CHECK", "1")
    monkeypatch.setenv("E2E_PUBAPI_BASE_URL", "https://pubapi.example.com")
    monkeypatch.setenv("E2E_PUBAPI_KEY", "pub-secret")
    assert live_e2e_skip_reason() is None


def test_skip_reason_ignores_pubapi_vars_when_vs_check_off(monkeypatch) -> None:
    """The PubApi creds are required only by the opt-in; the default suite ignores them."""
    _set_required_env(monkeypatch)
    monkeypatch.setenv("E2E_VS_CHECK", "0")
    for name in VS_CHECK_ENV:
        monkeypatch.delenv(name, raising=False)
    assert live_e2e_skip_reason() is None


def test_from_env_reads_pubapi_settings(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setenv("E2E_VS_CHECK", "1")
    monkeypatch.setenv("E2E_PUBAPI_BASE_URL", "https://pubapi.example.com/")
    monkeypatch.setenv("E2E_PUBAPI_KEY", "pub-secret")
    monkeypatch.setenv("E2E_PUBAPI_PROJECT_ID", "77")

    cfg = E2EConfig.from_env()
    assert cfg is not None
    assert cfg.vs_check is True
    assert cfg.pubapi_base_url == "https://pubapi.example.com"  # trailing slash stripped
    assert cfg.pubapi_key == "pub-secret"  # pragma: allowlist secret - test fixture value
    assert cfg.pubapi_project_id == 77


def test_from_env_none_on_bad_project_id(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setenv("E2E_PUBAPI_PROJECT_ID", "not-an-int")
    assert E2EConfig.from_env() is None


# ---------------------------------------------------------------------------
# PubApi query building and call-history filtering
# ---------------------------------------------------------------------------


def test_pubapi_datetime_converts_aware_value_to_naive_utc() -> None:
    """An aware value is normalised to UTC and stripped of its zone."""
    aware = datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC)
    assert pubapi_datetime(aware) == "2026-03-04T05:06:07"


def test_pubapi_datetime_leaves_naive_value_alone() -> None:
    assert pubapi_datetime(datetime(2026, 3, 4, 5, 6, 7)) == "2026-03-04T05:06:07"


def test_pubapi_query_percent_encodes_colons() -> None:
    """PubApi documents the timestamps as URL-encoded (``%3A``), not bare colons."""
    query = pubapi_call_history_query(
        datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC),
        datetime(2026, 3, 4, 5, 16, 7, tzinfo=UTC),
        limit=50,
    )
    assert "start=2026-03-04T05%3A06%3A07" in query
    assert "end=2026-03-04T05%3A16%3A07" in query
    assert "limit=50" in query
    assert ":" not in query


def test_pubapi_query_omits_project_id_unless_given() -> None:
    start = datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC)
    end = datetime(2026, 3, 4, 5, 16, 7, tzinfo=UTC)
    assert "project_id" not in pubapi_call_history_query(start, end)
    assert "project_id=77" in pubapi_call_history_query(start, end, project_id=77)


def test_call_histories_since_keeps_only_calls_in_the_window() -> None:
    """GetCallHistory filters on *modified* time, so old calls come back too."""
    rows = [
        {"call_history_id": 1, "call_date_time_utc": "2026-03-04T05:10:00Z"},
        {"call_history_id": 2, "call_date_time_utc": "2026-01-01T00:00:00Z"},
    ]
    kept = call_histories_since(rows, datetime(2026, 3, 4, 5, 0, 0, tzinfo=UTC))
    assert [r["call_history_id"] for r in kept] == [1]


def test_call_histories_since_drops_undatable_rows() -> None:
    """A row we cannot date is not evidence that this call reached VanillaSoft."""
    rows: list[dict[str, Any]] = [
        {"call_history_id": 1},
        {"call_history_id": 2, "call_date_time_utc": None},
        {"call_history_id": 3, "call_date_time_utc": "not a timestamp"},
    ]
    assert call_histories_since(rows, datetime(2026, 3, 4, 5, 0, 0, tzinfo=UTC)) == []


def test_call_histories_since_accepts_naive_boundary() -> None:
    """A naive ``since`` is read as UTC rather than raising on the comparison."""
    rows = [{"call_history_id": 1, "call_date_time_utc": "2026-03-04T05:10:00"}]
    kept = call_histories_since(rows, datetime(2026, 3, 4, 5, 0, 0))
    assert len(kept) == 1


def test_live_call_test_consumes_the_vs_check() -> None:
    """The live call test must request ``pubapi_client``, or ``vs_check`` is a no-op.

    ``E2E_VS_CHECK`` spent its first life parsed into ``E2EConfig`` and read by nothing,
    so setting it bought silent no-op coverage. Everything else here tests the machinery
    the flag *would* drive; this asserts the flag is actually plugged into a test. It is
    the check that fails if the wiring is reverted while the helpers survive.
    """
    from tests.live_e2e import test_live_call

    params = inspect.signature(test_live_call.test_inbound_call_posts).parameters
    assert "pubapi_client" in params


async def test_pubapi_client_sets_apikey_header_and_closes() -> None:
    """PubApi authenticates with ``APIKey=<key>``, not ``Bearer`` (ApiKeyUtil regex)."""
    client = PubApiClient("https://pubapi.example.com", "pub-secret")
    try:
        assert client._client.headers["authorization"] == "APIKey=pub-secret"
    finally:
        await client.aclose()


def _set_required_env(monkeypatch) -> None:
    """Set every var the live suite requires, so a test can vary one thing at a time."""
    monkeypatch.setenv("RUN_LIVE_E2E", "1")
    monkeypatch.setenv("E2E_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("E2E_API_KEY", "secret")
    monkeypatch.setenv("E2E_CUSTOMER_ID", "1")
    monkeypatch.setenv("E2E_DID_A", "+15145550001")
    monkeypatch.setenv("E2E_DID_B", "+15145550002")


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
