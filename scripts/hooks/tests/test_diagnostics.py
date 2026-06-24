"""Tests for scripts/diagnostics.py -- the shared lint/test digest library."""
import textwrap

import diagnostics as diag

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
    assert diag.source_header("scripts/lint-all.py (local)") == "# source: scripts/lint-all.py (local)"


def test_denoise_strips_npm_boilerplate():
    out = diag.denoise(["> vitest run", "npm warn deprecated", "", "FAIL src/foo.test.ts"])
    assert out == ["FAIL src/foo.test.ts"]


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
        "=== FAILURES ===", "___ test_big ___", *many_e_lines,
        "=== short test summary info ===", "FAILED tests/unit/test_big.py::test_big", "=== 1 failed ===",
    ]
    result = diag.filter_pytest_output(raw)
    assert any("truncated" in l for l in result)


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
    fe = ["> vitest run", "", "FAIL src/foo.test.ts > renders", "AssertionError: expected 1 to be 2"]
    any_failed, text, _ = diag.digest_tests(
        {"pytest": ([], 0), "frontend-tests": (fe, 1)}, "src",
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


def test_digest_tests_skips_env_error_source():
    any_failed, text, skips = diag.digest_tests(
        {"pytest": ([], 0), "frontend-tests": (["npm error could not be found"], 127)}, "src",
    )
    assert not any_failed
    assert text == ""
    assert ("frontend-tests", "not installed") in skips
