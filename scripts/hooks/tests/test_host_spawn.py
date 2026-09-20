"""Tests for scripts/host_spawn.py -- how a command is resolved and spawned here.

The two properties this file exists for:

- **No target ever spawns a bare `python`.** PATH's first interpreter is not this
  project's, so `--target hook-tests` came back `No module named pytest` on a
  provisioned worktree -- twice, off two different non-venv interpreters -- and the
  artifact reported `[FAIL] hook-tests`, a missing interpreter presented as a failing
  test tier.
- **A missing interpreter is never a skip.** `digest_tests` leaves `any_failed` False
  for one, so classifying it as environmental would report green having run nothing.
"""

import os
import sys
from pathlib import Path

from conftest import REPO_ROOT, load_module

hs = load_module("scripts/host_spawn.py")


# ---------------------------------------------------------------------------
# Interpreter resolution -- a bare `python` is PATH's, not this project's
# ---------------------------------------------------------------------------


def _make_venv_python(root: Path) -> Path:
    """Create a stub venv interpreter at the OS-correct path under `root`.

    The layout is spelled out rather than taken from `script_common.venv_exe`, so
    this fixture cannot agree with the code under test by construction.
    """
    parts = ("Scripts", "python.exe") if os.name == "nt" else ("bin", "python")
    exe = root.joinpath(".venv", *parts)
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.touch()
    return exe


def test_python_exe_prefers_the_checkout_venv(tmp_path):
    exe = _make_venv_python(tmp_path)
    assert hs.python_exe(tmp_path) == str(exe)


def test_python_exe_falls_back_to_this_interpreter_without_a_venv(tmp_path):
    """CI installs the locks `--system`, so there is no `.venv` to find there."""
    assert hs.python_exe(tmp_path) == sys.executable


def test_an_in_container_python_is_left_alone(tmp_path):
    """Only `argv[0]` is rewritten: the container's interpreter is not this machine's."""
    _make_venv_python(tmp_path)
    argv = ["docker", "compose", "exec", "-T", "app", "python", "-m", "pytest"]
    assert hs.resolve_argv(argv, tmp_path) == argv


def test_resolve_argv_still_shims_windows_batch_launchers(tmp_path, monkeypatch):
    """The rewrite this function already did must survive the interpreter branch."""
    monkeypatch.setattr(hs.os, "name", "nt")
    monkeypatch.setattr(hs.shutil, "which", lambda name: f"C:/n/{name}")
    assert hs.resolve_argv(["npm", "run", "test"], tmp_path) == ["C:/n/npm.cmd", "run", "test"]


def test_resolve_argv_tolerates_an_empty_argv(tmp_path):
    assert hs.resolve_argv([], tmp_path) == []


# ---------------------------------------------------------------------------
# ... and when there is no interpreter to resolve to, say which half failed
# ---------------------------------------------------------------------------


def test_interpreter_gap_names_the_interpreter_not_the_tier():
    """The reported symptom: `[FAIL] hook-tests` for a tier that never ran a test."""
    lines = hs.interpreter_gap_lines(
        ["C:/py/python.exe", "-m", "pytest", "scripts/hooks/tests"],
        ["C:/py/python.exe: No module named pytest"],
        fix="uv pip install -r requirements-dev.txt",
    )
    text = "\n".join(lines)
    assert "no `pytest`" in text
    assert "C:/py/python.exe" in text
    assert "the interpreter, not a test" in text
    assert "fix: uv pip install -r requirements-dev.txt" in text


def test_interpreter_gap_is_silent_without_a_fix_to_offer():
    lines = hs.interpreter_gap_lines(["python", "-m", "pytest"], ["python: No module named pytest"])
    assert lines and not any("fix:" in line for line in lines)


def test_interpreter_gap_says_nothing_about_a_real_test_failure():
    argv = ["python", "-m", "pytest", "tests/unit"]
    assert hs.interpreter_gap_lines(argv, ["1 failed, 40 passed"]) == []


def test_interpreter_gap_ignores_a_module_missing_inside_the_tests():
    """A test importing a package the project dropped is a real failure to fix.

    The two messages are told apart by the quotes: `ModuleNotFoundError` quotes the
    name, runpy does not. Explaining this one would tell an agent its own broken
    import was an environment problem.
    """
    argv = ["python", "-m", "pytest", "tests/unit"]
    lines = ["E   ModuleNotFoundError: No module named 'httpx'"]
    assert hs.interpreter_gap_lines(argv, lines) == []


def test_interpreter_gap_leaves_non_module_commands_alone():
    """`npm run test:run` can print anything; only a `-m` spawn is ours to explain."""
    argv = ["npm", "--prefix", "frontend", "run", "test:run"]
    assert hs.interpreter_gap_lines(argv, ["No module named pytest"]) == []


def test_a_missing_interpreter_stays_a_failure():
    """Never a skip: `digest_tests` leaves `any_failed` False for one, so a green run
    that executed nothing is the outcome this must not produce."""
    import failure_class

    assert failure_class.get_skip_reason(["python: No module named pytest"]) is None


def test_host_argv_uses_the_resolved_interpreter():
    argv = hs.host_argv("pytest -v -o addopts='-m \"not paid\"' tests/unit")
    assert argv[:3] == [hs.python_exe(), "-m", "pytest"]
    assert argv[-1] == "tests/unit"
    # shlex keeps `-o addopts=...` as one token, quotes and all -- the paid-tier
    # exclusion must survive the host tier or a fallback run collects paid tests.
    assert 'addopts=-m "not paid"' in argv


def test_resolve_argv_windows_npm_cmd(monkeypatch):
    monkeypatch.setattr(hs.os, "name", "nt")
    monkeypatch.setattr(
        hs.shutil,
        "which",
        lambda name: r"C:\Program Files\nodejs\npm.cmd" if name == "npm.cmd" else None,
    )
    assert hs.resolve_argv(["npm", "--prefix", "frontend", "run", "test:run"]) == [
        r"C:\Program Files\nodejs\npm.cmd",
        "--prefix",
        "frontend",
        "run",
        "test:run",
    ]


def test_resolve_argv_non_windows_unchanged(monkeypatch):
    monkeypatch.setattr(hs.os, "name", "posix")
    assert hs.resolve_argv(["npm", "run", "test:run"]) == ["npm", "run", "test:run"]


# ---------------------------------------------------------------------------
# End to end: the spawn itself, against a real interpreter
# ---------------------------------------------------------------------------


def test_run_argv_returns_the_output_and_the_exit_code():
    lines, code = hs.run_argv(["python", "-c", "print('spawned')"])
    assert lines == ["spawned"]
    assert code == 0


def test_run_argv_merges_stderr_into_the_same_stream():
    """One ordered stream: a traceback interleaved with prints is how it is read."""
    lines, code = hs.run_argv(
        ["python", "-c", "import sys; print('out'); print('err', file=sys.stderr)"]
    )
    assert set(lines) == {"out", "err"}
    assert code == 0


def test_run_argv_passes_extra_env_to_the_child():
    lines, code = hs.run_argv(
        ["python", "-c", "import os; print(os.environ['CARAMELI_SPAWN_PROBE'])"],
        extra_env={"CARAMELI_SPAWN_PROBE": "here"},
    )
    assert lines == ["here"]
    assert code == 0


def test_run_argv_explains_a_module_the_interpreter_does_not_have():
    """The whole defect, end to end: a `-m` spawn that cannot start says so."""
    lines, code = hs.run_argv(["python", "-m", "carameli_no_such_module"])
    assert code != 0
    assert any("carameli_no_such_module" in line for line in lines)
    assert any("the interpreter, not a test" in line for line in lines)


def test_python_fix_hint_is_the_toolchain_ladder():
    """The same string `session-start.sh` and `ship.py --preflight` print."""
    sys.path.insert(0, str(REPO_ROOT / "scripts" / "hooks"))
    import harness_config
    import toolchain

    cfg = harness_config.load(REPO_ROOT)
    expected = toolchain.python_fix(REPO_ROOT, cfg.python.install_command, cfg.python.version)
    assert hs.python_fix_hint(REPO_ROOT) == expected
    assert expected, "this repo has locks, so there is a ladder to print"


def test_python_fix_hint_offers_nothing_where_nothing_says_how(tmp_path):
    """An empty directory has no lock and no manifest -- and no remedy to suggest."""
    assert hs.python_fix_hint(tmp_path) == ""

