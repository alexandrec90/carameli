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


# --- load_script -----------------------------------------------------------


def test_load_script_imports_a_hyphenated_runner(tmp_path):
    """`run-tests.py` and `lint-all.py` are not importable names, and the alternative
    to this is a second copy of whatever is shared -- which is how `--changed` came to
    mean two different sets of files in the two runners at once."""
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "a-runner.py").write_text("VALUE = 7\n", encoding="utf-8")

    module = sc.load_script("scripts/a-runner.py", tmp_path)
    assert module.VALUE == 7


def test_load_script_registers_before_executing(tmp_path):
    """The rule this exists to follow, and the whole reason it is a shared helper.

    `@dataclass` under `from __future__ import annotations` resolves its own field
    annotations by looking the defining module up in `sys.modules` BY NAME. An
    unregistered module makes that lookup return None and the import dies inside
    `dataclasses` with a traceback pointing at CPython, not at the loader -- so a
    loader that skips this works on every plain module and breaks the day its target
    grows a dataclass.

    Reversion check: drop the `sys.modules[name] = module` line and this raises.
    """
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "b-runner.py").write_text(
        "from __future__ import annotations\n"
        "from dataclasses import dataclass\n"
        "\n"
        "@dataclass(frozen=True)\n"
        "class Shape:\n"
        "    parts: list[str]\n",
        encoding="utf-8",
    )

    module = sc.load_script("scripts/b-runner.py", tmp_path)
    assert module.Shape(parts=["a"]).parts == ["a"]


def test_load_script_returns_the_same_module_twice(tmp_path):
    """One copy per name, so two runners importing the same helper monkeypatch the
    same object -- a second copy is a stub installed where nothing reads it."""
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "c-runner.py").write_text("VALUE = 1\n", encoding="utf-8")

    first = sc.load_script("scripts/c-runner.py", tmp_path)
    first.VALUE = 2
    assert sc.load_script("scripts/c-runner.py", tmp_path).VALUE == 2


def test_load_script_leaves_nothing_registered_when_the_target_raises(tmp_path):
    """A half-executed module in `sys.modules` would be handed to the next caller as
    if it had loaded."""
    import sys

    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "d-runner.py").write_text(
        "raise RuntimeError('boom')\n", encoding="utf-8"
    )

    try:
        sc.load_script("scripts/d-runner.py", tmp_path)
    except RuntimeError:
        pass
    else:
        raise AssertionError("the target's exception must reach the caller")
    assert "_carameli_d_runner" not in sys.modules


def test_load_script_refuses_a_path_that_is_not_there(tmp_path):
    try:
        sc.load_script("scripts/nope.py", tmp_path)
    except (ImportError, FileNotFoundError):
        pass
    else:
        raise AssertionError("a missing script must refuse rather than answer empty")
