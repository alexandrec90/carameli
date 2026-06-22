"""Tests for scripts/ci-digest.py — the CI artifact digest script."""
import textwrap

from conftest import load_module

ci = load_module("scripts/ci-digest.py")


# ---------------------------------------------------------------------------
# get_skip_reason
# ---------------------------------------------------------------------------

def test_get_skip_reason_missing_tool():
    assert ci.get_skip_reason(["command not found: ruff"]) == "not installed"


def test_get_skip_reason_env_error():
    assert ci.get_skip_reason(["connection refused"]) == "environment error"


def test_get_skip_reason_real_error():
    assert ci.get_skip_reason(["app/main.py:10:1: F401 unused import"]) is None


def test_get_skip_reason_empty():
    assert ci.get_skip_reason([]) is None


# ---------------------------------------------------------------------------
# read_report — missing files produce empty/0 defaults
# ---------------------------------------------------------------------------

def test_read_report_missing_files(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    lines, code = ci.read_report("nonexistent")
    assert lines == []
    assert code == 0


def test_read_report_present(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    (tmp_path / "mytool.txt").write_text("line1\nline2\n")
    (tmp_path / "mytool.exit").write_text("1\n")
    lines, code = ci.read_report("mytool")
    assert lines == ["line1", "line2"]
    assert code == 1


def test_read_report_corrupt_exit(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    (tmp_path / "mytool.txt").write_text("")
    (tmp_path / "mytool.exit").write_text("not-a-number")
    _, code = ci.read_report("mytool")
    assert code == 1


# ---------------------------------------------------------------------------
# filter_pytest_output — port of run-tests.ps1 filtering logic
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
    result = ci.filter_pytest_output(raw)
    assert any("AssertionError" in l for l in result)
    assert any("test_something" in l for l in result)
    # session starts line stripped
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
    result = ci.filter_pytest_output(raw)
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
    result = ci.filter_pytest_output(raw)
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
    result = ci.filter_pytest_output(raw)
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
    result = ci.filter_pytest_output(raw)
    assert any("[raw fallback" in l for l in result)


def test_filter_caps_block_at_max():
    many_e_lines = [f"E   line {n}" for n in range(30)]
    raw = (
        ["=== FAILURES ===", "___ test_big ___", *many_e_lines, "=== short test summary info ===", "FAILED tests/unit/test_big.py::test_big", "=== 1 failed ==="]
    )
    result = ci.filter_pytest_output(raw)
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
    result = ci.filter_pytest_output(raw)
    assert any("1 failed" in l for l in result)


def test_filter_empty_output():
    assert ci.filter_pytest_output([]) == []


# ---------------------------------------------------------------------------
# digest_lint — artifact written correctly
# ---------------------------------------------------------------------------

def test_digest_lint_pass_clears_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "ruff-check.txt").write_text("")
    (tmp_path / "ruff-check.exit").write_text("0")
    result = ci.digest_lint()
    assert not result
    assert (tmp_path / "lint-errors.log").read_text() == ""


def test_digest_lint_failure_writes_section(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "ruff-check.txt").write_text("app/main.py:1:1: F401 unused import os\n")
    (tmp_path / "ruff-check.exit").write_text("1")
    result = ci.digest_lint()
    assert result
    content = (tmp_path / "lint-errors.log").read_text()
    assert content.startswith(ci.SOURCE_HEADER)  # provenance stamp on non-empty artifact
    assert "# ruff" in content
    assert "app/main.py" in content


def test_digest_lint_skips_env_errors(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "mypy.txt").write_text("command not found: mypy\n")
    (tmp_path / "mypy.exit").write_text("127")
    result = ci.digest_lint()
    assert not result  # skip reason, not a real failure
    content = (tmp_path / "lint-errors.log").read_text()
    assert "# mypy" not in content


def test_digest_lint_alembic_synthetic_locator(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "alembic-check.txt").write_text("Target database is not up to date.\n")
    (tmp_path / "alembic-check.exit").write_text("1")
    result = ci.digest_lint()
    assert result
    content = (tmp_path / "lint-errors.log").read_text()
    assert "alembic/versions/env.py:1:1" in content


# ---------------------------------------------------------------------------
# digest_tests — artifact written correctly
# ---------------------------------------------------------------------------

def test_digest_tests_pass_clears_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "pytest.txt").write_text("1 passed in 0.5s\n")
    (tmp_path / "pytest.exit").write_text("0")
    result = ci.digest_tests()
    assert not result
    assert (tmp_path / "test-failures.log").read_text() == ""


def test_digest_tests_failure_writes_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    raw = "\n".join([
        "=== FAILURES ===",
        "___ test_foo ___",
        "    app/services/foo.py:10: in bar",
        "E   AssertionError: nope",
        "=== short test summary info ===",
        "FAILED tests/unit/test_foo.py::test_foo",
        "=== 1 failed in 0.3s ===",
    ])
    (tmp_path / "pytest.txt").write_text(raw)
    (tmp_path / "pytest.exit").write_text("1")
    result = ci.digest_tests()
    assert result
    content = (tmp_path / "test-failures.log").read_text()
    assert "# pytest" in content
    assert "AssertionError" in content
    assert "1 failed" in content


def test_digest_tests_folds_frontend_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "pytest.txt").write_text("1 passed in 0.1s\n")
    (tmp_path / "pytest.exit").write_text("0")
    (tmp_path / "frontend-tests.txt").write_text(
        "> vitest run\n\nFAIL src/foo.test.ts > renders\nAssertionError: expected 1 to be 2\n"
    )
    (tmp_path / "frontend-tests.exit").write_text("1")
    result = ci.digest_tests()
    assert result
    content = (tmp_path / "test-failures.log").read_text()
    assert "# frontend-tests" in content
    assert "FAIL src/foo.test.ts" in content
    # npm boilerplate denoised away
    assert "> vitest run" not in content


def test_digest_tests_folds_hook_test_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "pytest.txt").write_text("")
    (tmp_path / "pytest.exit").write_text("0")
    raw = "\n".join([
        "=== FAILURES ===",
        "___ test_hook ___",
        "    scripts/hooks/foo.py:3: in run",
        "E   ValueError: boom",
        "=== short test summary info ===",
        "FAILED scripts/hooks/tests/test_foo.py::test_hook",
        "=== 1 failed in 0.1s ===",
    ])
    (tmp_path / "hook-tests.txt").write_text(raw)
    (tmp_path / "hook-tests.exit").write_text("1")
    result = ci.digest_tests()
    assert result
    content = (tmp_path / "test-failures.log").read_text()
    assert "# hook-tests" in content
    assert "ValueError: boom" in content


def test_digest_tests_skips_env_error_source(tmp_path, monkeypatch):
    monkeypatch.setattr(ci, "REPORTS", tmp_path)
    monkeypatch.setattr(ci, "LOGS", tmp_path)
    (tmp_path / "pytest.txt").write_text("")
    (tmp_path / "pytest.exit").write_text("0")
    # frontend runner missing entirely — not a code failure
    (tmp_path / "frontend-tests.txt").write_text("npm error could not be found\n")
    (tmp_path / "frontend-tests.exit").write_text("127")
    result = ci.digest_tests()
    assert not result
    assert (tmp_path / "test-failures.log").read_text() == ""
