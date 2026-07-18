"""Tests for scripts/venv-install.py -- the uv-based dev-toolchain installer."""

import pytest
from conftest import load_module

vi = load_module("scripts/venv-install.py")


def test_venv_python_layout_per_os(tmp_path):
    assert vi.venv_python(tmp_path, windows=True) == (
        tmp_path / ".venv" / "Scripts" / "python.exe"
    )
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
