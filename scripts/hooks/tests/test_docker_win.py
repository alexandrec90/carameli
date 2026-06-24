"""Tests for scripts/docker_win.py pure helpers."""
from pathlib import Path

from conftest import load_module

dw = load_module("scripts/docker_win.py")


def test_filter_taskkill_noise_drops_not_found():
    lines = ["SUCCESS: process killed", 'ERROR: process "x.exe" not found', "INFO: done"]
    assert dw.filter_taskkill_noise(lines) == ["SUCCESS: process killed", "INFO: done"]


def test_vhdx_path_uses_localappdata(monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\x\AppData\Local")
    path = dw.vhdx_path()
    assert path.name == "docker_data.vhdx"
    assert "wsl" in path.parts and "disk" in path.parts


def test_expand_state_dirs(monkeypatch):
    monkeypatch.setenv("APPDATA", r"C:\Users\x\AppData\Roaming")
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\x\AppData\Local")
    dirs = dw.expand_state_dirs()
    assert all(isinstance(d, Path) for d in dirs)
    assert all("%" not in str(d) for d in dirs)


def test_launch_docker_desktop_missing_exe_returns_false(tmp_path):
    assert dw.launch_docker_desktop(str(tmp_path / "nope.exe")) is False
