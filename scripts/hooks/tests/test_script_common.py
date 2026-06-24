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
