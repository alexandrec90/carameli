"""Tests for scripts/script_common.py venv path resolution."""

from conftest import load_module

sc = load_module("scripts/script_common.py")


def test_venv_rel_parts_windows():
    assert sc.venv_rel_parts("locust", "nt") == (".venv", "Scripts", "locust.exe")


def test_venv_rel_parts_posix():
    assert sc.venv_rel_parts("locust", "posix") == (".venv", "bin", "locust")


def test_venv_exe_uses_repo_root():
    path = sc.venv_exe("mutmut")
    assert path.parts[-3] == ".venv"
    assert path.name in ("mutmut", "mutmut.exe")


def test_format_status_line():
    assert sc.format_status_line(sc.FAIL, "mypy") == "  [FAIL] mypy"
    assert sc.format_status_line(sc.PASS, "pytest") == "  [pass] pytest"


def test_format_banner_passed():
    lines = sc.format_banner("TESTS", passed=True)
    # blank, bar, centered text, bar, blank
    assert lines[0] == "" and lines[-1] == ""
    assert lines[1] == lines[3] and set(lines[1].strip()) == {"="}
    assert lines[2].strip() == "TESTS PASSED"
    # text is centered within the bar width
    assert len(lines[2]) == len(lines[1])


def test_format_banner_failed():
    lines = sc.format_banner("LINT", passed=False)
    assert lines[2].strip() == "LINT FAILED"


def test_format_results_line():
    assert (
        sc.format_results_line((35, 0, 3), "tests")
        == "Results: 35 passed, 0 failed, 3 skipped (38 tests)"
    )
    assert sc.format_results_line((12, 2, 1), "checks").endswith("(15 checks)")


def test_emit_report_pass_clears_artifact_and_returns_zero(tmp_path, capsys):
    artifact = tmp_path / "logs" / "out.log"
    artifact.parent.mkdir()
    artifact.write_text("stale errors", encoding="utf-8")

    code = sc.emit_report(
        noun="TESTS",
        artifact_path=artifact,
        statuses=[(sc.PASS, "pytest")],
        artifact_text="",
        failed=False,
    )

    assert code == 0
    assert artifact.read_text(encoding="utf-8") == ""  # cleared on pass
    out = capsys.readouterr().out
    assert "  [pass] pytest" in out
    assert "TESTS PASSED" in out
    assert "Errors written to" not in out


def test_emit_report_fail_writes_artifact_and_returns_one(tmp_path, capsys):
    artifact = tmp_path / "out.log"

    code = sc.emit_report(
        noun="E2E",
        artifact_path=artifact,
        statuses=[(sc.FAIL, "test_login")],
        artifact_text="# pytest\nE  AssertionError\n",
        failed=True,
        counts=(0, 1, 0),
        unit="tests",
    )

    assert code == 1
    assert "AssertionError" in artifact.read_text(encoding="utf-8")
    out = capsys.readouterr().out
    assert "  [FAIL] test_login" in out
    assert "Results: 0 passed, 1 failed, 0 skipped (1 tests)" in out
    assert str(artifact) in out  # "Errors written to: <path>"
    assert "E2E FAILED" in out


def test_emit_report_omits_results_line_when_no_counts(capsys, tmp_path):
    sc.emit_report(
        noun="LINT",
        artifact_path=tmp_path / "out.log",
        statuses=[],
        artifact_text="",
        failed=False,
    )
    assert "Results:" not in capsys.readouterr().out
