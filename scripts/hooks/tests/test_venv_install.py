"""Tests for scripts/venv-install.py -- the uv-based dev-toolchain installer."""

import subprocess

import pytest
from conftest import load_module

vi = load_module("scripts/venv-install.py")
bootstrap = load_module("scripts/bootstrap.py")


def test_venv_python_layout_per_os(tmp_path):
    assert vi.venv_python(tmp_path, windows=True) == (tmp_path / ".venv" / "Scripts" / "python.exe")
    assert vi.venv_python(tmp_path, windows=False) == tmp_path / ".venv" / "bin" / "python"


def test_uv_pin_extracts_the_pinned_version():
    lock = "asyncpg==0.30.0\nuv==0.11.29\n    # via -r requirements-dev.in\nruff==0.15.22\n"
    assert vi.uv_pin(lock) == "0.11.29"


def test_uv_pin_raises_when_absent():
    with pytest.raises(ValueError, match="uv=="):
        vi.uv_pin("ruff==0.15.22\nmypy==2.3.0\n")


def test_install_commands_bootstrap_pip_then_uv(tmp_path):
    py = vi.venv_python(tmp_path, windows=False)
    commands = vi.install_commands(py, "0.11.29")
    assert len(commands) == 2

    # First: pip bootstraps uv itself (the only place uv can't be present yet).
    assert commands[0][:4] == [str(py), "-m", "pip", "install"]
    assert "uv==0.11.29" in commands[0]

    # Second: uv installs the dev lock, targeting the venv explicitly so an
    # already-active venv (VS Code auto-activation) doesn't redirect it.
    assert commands[1][:4] == [str(py), "-m", "uv", "pip"]
    assert commands[1][commands[1].index("--python") + 1] == str(py)
    assert commands[1][-2:] == ["-r", "requirements-dev.txt"]


# --- venv creation is bootstrap's job, not this script's --------------------


def test_missing_venv_is_created_by_bootstrap(monkeypatch, tmp_path):
    # `python -m venv`, which this used to call, can only clone the interpreter
    # running it -- the workstation default, not the version the image pins. That
    # produced a venv the container does not match, and the mismatch surfaces later
    # as an install or type-check failure that reads as a broken branch.
    monkeypatch.setattr(vi, "REPO_ROOT", tmp_path)
    (tmp_path / "requirements-dev.txt").write_text("uv==0.11.29\n", encoding="utf-8")
    created = []
    monkeypatch.setattr(bootstrap, "create_venv", lambda root: created.append(root) or 0)
    monkeypatch.setattr(subprocess, "run", lambda argv, **k: subprocess.CompletedProcess(argv, 0))

    assert vi.main() == 0
    assert created == [tmp_path]


def test_a_failed_venv_creation_stops_the_install(monkeypatch, tmp_path):
    monkeypatch.setattr(vi, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(bootstrap, "create_venv", lambda root: 1)
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: pytest.fail("installed into a venv that is not there")
    )

    assert vi.main() == 1
