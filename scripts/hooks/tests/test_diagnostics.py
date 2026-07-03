"""Tests for scripts/diagnostics.py -- the shared lint/test digest library."""

import textwrap

import diagnostics as diag

# ---------------------------------------------------------------------------
# count_test_summary
# ---------------------------------------------------------------------------


def test_count_test_summary_pytest():
    lines = [
        "tests/unit/test_x.py::test_a PASSED",  # per-test line must NOT be counted
        "==== 34 passed, 3 skipped, 1 failed in 4.56s ====",
    ]
    assert diag.count_test_summary(lines) == (34, 1, 3)


def test_count_test_summary_vitest():
    assert diag.count_test_summary(["  Tests  35 passed | 2 failed (37)"]) == (35, 2, 0)


def test_count_test_summary_strips_ansi_from_vitest():
    # vitest colourises its summary; the leading SGR codes must not stop the
    # `^\s*Tests` match from finding the counts.
    line = "\x1b[2m      Tests \x1b[22m \x1b[31m13 failed\x1b[39m | \x1b[32m31 passed\x1b[39m (44)"
    assert diag.count_test_summary([line]) == (31, 13, 0)


def test_count_test_summary_vitest_ignores_test_files_line():
    # The "Test Files" line must not be counted alongside the "Tests" line.
    lines = ["  Test Files  3 passed (3)", "       Tests  35 passed (35)"]
    assert diag.count_test_summary(lines) == (35, 0, 0)


def test_count_test_summary_counts_errors_as_failures():
    assert diag.count_test_summary(["==== 2 errors in 0.10s ===="]) == (0, 2, 0)


def test_count_test_summary_no_summary_line():
    assert diag.count_test_summary(["ImportError: boom", "tests/x.py::t PASSED"]) == (0, 0, 0)


# ---------------------------------------------------------------------------
# get_skip_reason
# ---------------------------------------------------------------------------


def test_get_skip_reason_missing_tool():
    assert diag.get_skip_reason(["command not found: ruff"]) == "not installed"


def test_get_skip_reason_env_error():
    assert diag.get_skip_reason(["connection refused"]) == "environment error"


def test_get_skip_reason_real_error():
    assert diag.get_skip_reason(["app/main.py:10:1: F401 unused import"]) is None


def test_get_skip_reason_empty():
    assert diag.get_skip_reason([]) is None


def test_source_header():
    assert (
        diag.source_header("scripts/lint-all.py (local)") == "# source: scripts/lint-all.py (local)"
    )


def test_denoise_strips_npm_boilerplate():
    out = diag.denoise(["> vitest run", "npm warn deprecated", "", "FAIL src/foo.test.ts"])
    assert out == ["FAIL src/foo.test.ts"]


# ---------------------------------------------------------------------------
# strip_ansi -- terminal colour codes must never reach the artifact
# ---------------------------------------------------------------------------


def test_strip_ansi_removes_sgr_codes():
    assert diag.strip_ansi("\x1b[31m\x1b[1mFAIL\x1b[22m\x1b[39m src/foo.test.ts") == (
        "FAIL src/foo.test.ts"
    )


def test_strip_ansi_leaves_plain_text_untouched():
    assert diag.strip_ansi("app/main.py:10:1: F401 unused import") == (
        "app/main.py:10:1: F401 unused import"
    )


def test_strip_ansi_lines_maps_over_list():
    assert diag.strip_ansi_lines(["\x1b[36mok\x1b[39m", "plain"]) == ["ok", "plain"]


def test_digest_tests_strips_ansi_from_frontend_section():
    # vitest output is colourised; the written artifact must be plain text.
    raw = ["\x1b[31m❯\x1b[39m src/foo.test.ts \x1b[31m(1 failed)\x1b[39m"]  # noqa: RUF001
    any_failed, text, _skips = diag.digest_tests({"frontend-tests": (raw, 1)}, "run-tests.py")
    assert any_failed
    assert "\x1b[" not in text
    assert "❯ src/foo.test.ts (1 failed)" in text  # noqa: RUF001


# ---------------------------------------------------------------------------
# filter_pytest_output -- the pytest failure-block filter
# ---------------------------------------------------------------------------


def _raw(text: str) -> list[str]:
    return textwrap.dedent(text).strip().splitlines()


def test_filter_passes_failure_block():
    raw = _raw("""
        =========================== test session starts ============================
        collected 1 item

        === FAILURES ===
        ___ test_something ___
            app/services/foo.py:42: in bar
        E   AssertionError: expected 1, got 2
        === short test summary info ===
        FAILED tests/unit/test_foo.py::test_something
        === 1 failed in 0.5s ===
    """)
    result = diag.filter_pytest_output(raw)
    assert any("AssertionError" in l for l in result)
    assert any("test_something" in l for l in result)
    assert not any("test session starts" in l for l in result)


def test_filter_drops_library_frames():
    raw = _raw("""
        === FAILURES ===
        ___ test_x ___
            sqlalchemy/orm/session.py:123: in commit
        E   sqlalchemy.exc.IntegrityError: duplicate key
            app/repos/phone_line.py:55: in create
        === short test summary info ===
        FAILED tests/unit/test_x.py::test_x
        === 1 failed ===
    """)
    result = diag.filter_pytest_output(raw)
    assert not any("sqlalchemy/orm" in l for l in result)
    assert any("app/repos/phone_line.py" in l for l in result)


def test_filter_drops_info_log_noise():
    raw = _raw("""
        === FAILURES ===
        ___ test_y ___
        INFO     app.core.config:config.py:10 App started
        DEBUG    app.core.config:config.py:11 debug msg
        E   AssertionError: nope
        === short test summary info ===
        FAILED tests/unit/test_y.py::test_y
        === 1 failed ===
    """)
    result = diag.filter_pytest_output(raw)
    assert not any("INFO" in l for l in result)
    assert not any("DEBUG" in l for l in result)
    assert any("AssertionError" in l for l in result)


def test_filter_keeps_warning_log_lines():
    raw = _raw("""
        === FAILURES ===
        ___ test_z ___
        ----- Captured log call -----
        WARNING  app.services.sms:sms.py:77 carrier timeout
        E   TimeoutError: carrier did not respond
        === short test summary info ===
        FAILED tests/unit/test_z.py::test_z
        === 1 failed ===
    """)
    result = diag.filter_pytest_output(raw)
    assert any("WARNING" in l for l in result)


def test_filter_raw_fallback_when_no_e_lines():
    raw = _raw("""
        === FAILURES ===
        ___ test_w ___
            some/library/frame.py:1: in something
            another/library.py:2: raises
        === short test summary info ===
        FAILED tests/unit/test_w.py::test_w
        === 1 failed ===
    """)
    result = diag.filter_pytest_output(raw)
    assert any("[raw fallback" in l for l in result)


def test_filter_caps_block_at_max():
    many_e_lines = [f"E   line {n}" for n in range(30)]
    raw = [
        "=== FAILURES ===",
        "___ test_big ___",
        *many_e_lines,
        "=== short test summary info ===",
        "FAILED tests/unit/test_big.py::test_big",
        "=== 1 failed ===",
    ]
    result = diag.filter_pytest_output(raw)
    assert any("truncated" in l for l in result)


def test_filter_truncation_keeps_block_tail():
    # A captured subprocess traceback carries the real error on its LAST line;
    # truncation must preserve the tail, not just the head boilerplate.
    e_lines = [f"E   frame {n}" for n in range(40)]
    e_lines.append("E   sqlalchemy.exc.ProgrammingError: the real root cause")
    raw = [
        "=== FAILURES ===",
        "___ test_big ___",
        *e_lines,
        "=== short test summary info ===",
        "FAILED tests/unit/test_big.py::test_big",
        "=== 1 failed ===",
    ]
    result = diag.filter_pytest_output(raw)
    assert any("truncated" in l for l in result)
    assert any("the real root cause" in l for l in result)


def test_filter_appends_stats_line():
    raw = _raw("""
        === FAILURES ===
        ___ test_q ___
        E   ValueError: bad value
        === short test summary info ===
        FAILED tests/unit/test_q.py::test_q
        === 1 failed in 1.2s ===
    """)
    result = diag.filter_pytest_output(raw)
    assert any("1 failed" in l for l in result)


def test_filter_empty_output():
    assert diag.filter_pytest_output([]) == []


def test_filter_drops_warnings_summary():
    # The warnings summary is not a failure; its lines embed `tests/foo.py:NN`
    # and would otherwise survive the first-party-frame keep. They must be gone,
    # while the real failure and its E-line stay.
    raw = _raw("""
        === FAILURES ===
        ___ test_real ___
            app/services/foo.py:42: in bar
        E   AssertionError: boom
        === warnings summary ===
        tests/unit/test_agent_status.py:400: PytestWarning: marked with asyncio
        tests/unit/test_config.py:10: PytestWarning: marked with asyncio
        === short test summary info ===
        FAILED tests/unit/test_real.py::test_real
        === 1 failed in 0.5s ===
    """)
    result = diag.filter_pytest_output(raw)
    assert any("AssertionError: boom" in l for l in result)
    assert not any("PytestWarning" in l for l in result)
    assert not any("test_agent_status.py:400" in l for l in result)


# ---------------------------------------------------------------------------
# filter_vitest_output -- the vitest (frontend) failure filter
# ---------------------------------------------------------------------------


def test_filter_vitest_drops_passing_and_keeps_failures():
    raw = [
        " RUN  v2.1.9 /frontend",
        " ✓ src/tests/useSms.test.ts (4 tests) 390ms",
        " ❯ src/tests/useApiToken.test.ts (4 tests | 1 failed) 381ms",  # noqa: RUF001
        "   × useApiToken > surfaces an error when the request fails 92ms",  # noqa: RUF001
        "     → 500 boom",
        " Test Files  1 failed | 22 passed (23)",
        "      Tests  1 failed | 144 passed (145)",
        "   Duration  54.24s",
    ]
    result = diag.filter_vitest_output(raw)
    assert not any("✓" in l for l in result)  # passing files dropped
    assert not any("RUN  v2.1.9" in l for l in result)  # run banner dropped
    assert not any("Duration" in l for l in result)  # timing footer dropped
    assert not any("Test Files" in l for l in result)  # kept only the Tests summary
    assert any("useApiToken.test.ts (4 tests | 1 failed)" in l for l in result)
    assert any("× useApiToken" in l for l in result)  # noqa: RUF001
    assert any("→ 500 boom" in l for l in result)
    assert any("Tests  1 failed | 144 passed" in l for l in result)


def test_filter_vitest_drops_stderr_capture_blocks():
    # React act(...) warnings and expected [WARN] logs stream under a
    # `stderr |` header from *passing* tests -- pure noise that must be dropped
    # while the FAIL detail block survives.
    raw = [
        "stderr | src/tests/useSpeedDials.test.ts > re-fetches after create",
        "An update to TestComponent inside a test was not wrapped in act(...).",
        "act(() => {",
        "  /* fire events that update state */",
        "});",
        " ✓ src/tests/useSpeedDials.test.ts (4 tests) 370ms",
        "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯",
        " FAIL  src/tests/useApiToken.test.ts > surfaces an error when the request fails",
        "Error: 500 boom",
        " ❯ src/tests/useApiToken.test.ts:45:32",  # noqa: RUF001
        "      Tests  1 failed | 144 passed (145)",
    ]
    result = diag.filter_vitest_output(raw)
    assert not any("act(" in l for l in result)
    assert not any("TestComponent" in l for l in result)
    assert any("FAIL  src/tests/useApiToken.test.ts" in l for l in result)
    assert any("Error: 500 boom" in l for l in result)
    assert any("useApiToken.test.ts:45:32" in l for l in result)


def test_filter_vitest_falls_back_when_all_stripped():
    # If nothing matches the keep rules, fall back to denoise so the agent is
    # never handed an empty section.
    raw = ["> vitest run", "some unrecognised line"]
    result = diag.filter_vitest_output(raw)
    assert result == ["some unrecognised line"]


# ---------------------------------------------------------------------------
# digest_lint -- builds the lint-errors.log text from in-memory results
# ---------------------------------------------------------------------------


def test_digest_lint_pass_returns_empty():
    any_failed, text, skips = diag.digest_lint({"ruff-check": ([], 0)}, "src")
    assert not any_failed
    assert text == ""
    assert skips == []


def test_digest_lint_failure_writes_section():
    results = {"ruff-check": (["app/main.py:1:1: F401 unused import os"], 1)}
    any_failed, text, _ = diag.digest_lint(results, "scripts/lint-all.py (local)")
    assert any_failed
    assert text.startswith(diag.source_header("scripts/lint-all.py (local)"))
    assert "# ruff-check" in text
    assert "app/main.py" in text


def test_digest_lint_skips_env_errors():
    any_failed, text, skips = diag.digest_lint({"mypy": (["command not found: mypy"], 127)}, "src")
    assert not any_failed
    assert "# mypy" not in text
    assert ("mypy", "not installed") in skips


def test_digest_lint_alembic_synthetic_locator():
    results = {"alembic-check": (["Target database is not up to date."], 1)}
    any_failed, text, _ = diag.digest_lint(results, "src")
    assert any_failed
    assert "alembic/versions/env.py:1:1" in text


def test_digest_lint_absent_tool_is_pass():
    # A tool not present in results (e.g. not run in this env) is a clean pass.
    any_failed, text, _ = diag.digest_lint({}, "src")
    assert not any_failed
    assert text == ""


# ---------------------------------------------------------------------------
# digest_tests -- builds the test-failures.log text from in-memory results
# ---------------------------------------------------------------------------


def test_digest_tests_pass_returns_empty():
    any_failed, text, _ = diag.digest_tests({"pytest": ([], 0)}, "src")
    assert not any_failed
    assert text == ""


def test_digest_tests_failure_writes_artifact():
    raw = [
        "=== FAILURES ===",
        "___ test_foo ___",
        "    app/services/foo.py:10: in bar",
        "E   AssertionError: nope",
        "=== short test summary info ===",
        "FAILED tests/unit/test_foo.py::test_foo",
        "=== 1 failed in 0.3s ===",
    ]
    any_failed, text, _ = diag.digest_tests({"pytest": (raw, 1)}, "src")
    assert any_failed
    assert "# pytest" in text
    assert "AssertionError" in text
    assert "1 failed" in text


def test_digest_tests_folds_frontend_failures():
    fe = [
        "> vitest run",
        "",
        "FAIL src/foo.test.ts > renders",
        "AssertionError: expected 1 to be 2",
    ]
    any_failed, text, _ = diag.digest_tests(
        {"pytest": ([], 0), "frontend-tests": (fe, 1)},
        "src",
    )
    assert any_failed
    assert "# frontend-tests" in text
    assert "FAIL src/foo.test.ts" in text
    assert "> vitest run" not in text  # npm boilerplate denoised away


def test_digest_tests_folds_hook_failures():
    raw = [
        "=== FAILURES ===",
        "___ test_hook ___",
        "    scripts/hooks/foo.py:3: in run",
        "E   ValueError: boom",
        "=== short test summary info ===",
        "FAILED scripts/hooks/tests/test_foo.py::test_hook",
        "=== 1 failed in 0.1s ===",
    ]
    any_failed, text, _ = diag.digest_tests({"pytest": ([], 0), "hook-tests": (raw, 1)}, "src")
    assert any_failed
    assert "# hook-tests" in text
    assert "ValueError: boom" in text


def test_digest_tests_folds_telnyx_sandbox_failures():
    raw = [
        "=== FAILURES ===",
        "___ test_telnyx_sandbox ___",
        "    tests/integration/test_telnyx_sandbox.py:44: in test_telnyx_sandbox",
        "E   AssertionError: expected sandbox response",
        "=== short test summary info ===",
        "FAILED tests/integration/test_telnyx_sandbox.py::test_telnyx_sandbox",
        "=== 1 failed in 0.2s ===",
    ]
    any_failed, text, _ = diag.digest_tests({"telnyx-sandbox": (raw, 1)}, "src")
    assert any_failed
    assert "# telnyx-sandbox" in text
    assert "AssertionError: expected sandbox response" in text


def test_digest_tests_skips_env_error_source():
    any_failed, text, skips = diag.digest_tests(
        {"pytest": ([], 0), "frontend-tests": (["npm error could not be found"], 127)},
        "src",
    )
    assert not any_failed
    assert text == ""
    assert ("frontend-tests", "not installed") in skips
