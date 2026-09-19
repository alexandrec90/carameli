"""Tests for scripts/run-local-e2e.py interpreter selection.

The suite this runner drives exists because the LegacyCRM machine has no project venv
and often no Python at all, so the fallback path -- `uv run --python <pin> --no-project`
-- is the one that actually runs there, on the machine least able to report a bad
interpreter clearly. It named the version as a literal and so was a second Python pin
that no bump of `.python-version` would have moved.
"""

from pathlib import Path

from conftest import REPO_ROOT, load_module

e2e = load_module("scripts/run-local-e2e.py")

PIN = (REPO_ROOT / ".python-version").read_text(encoding="utf-8").strip()


def test_the_project_venv_wins_when_it_exists(tmp_path):
    venv_python = tmp_path / "python.exe"
    venv_python.write_text("", encoding="utf-8")

    cmd, description = e2e.resolve_pytest_cmd(venv_python, has_uv=True)

    assert cmd == [str(venv_python), "-m", "pytest"]
    assert ".venv" in description


def test_the_uv_fallback_asks_for_the_pinned_interpreter():
    cmd, description = e2e.resolve_pytest_cmd(Path("nonexistent"), has_uv=True)

    assert cmd[: cmd.index("--python") + 2] == ["uv", "run", "--python", PIN]
    assert "--no-project" in cmd
    assert cmd[-1] == "pytest"
    assert "ephemeral" in description


def test_the_fallback_carries_only_the_dependency_light_deps():
    cmd, _ = e2e.resolve_pytest_cmd(Path("nonexistent"), has_uv=True)

    withs = [cmd[i + 1] for i, part in enumerate(cmd) if part == "--with"]
    assert withs == list(e2e.EPHEMERAL_DEPS)
    assert not any(dep.startswith(("alembic", "asyncpg", "sqlalchemy")) for dep in withs)


def test_no_uv_and_no_venv_reports_the_pinned_interpreter_in_the_fix():
    cmd, reason = e2e.resolve_pytest_cmd(Path("nonexistent"), has_uv=False)

    assert cmd is None
    assert f"uv venv --python {PIN}" in reason
