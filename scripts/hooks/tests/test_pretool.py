"""Unit tests for the PreToolUse dispatcher's marker selection."""

from conftest import load_module

hook = load_module("scripts/hooks/pretool.py")


def test_no_markers_selects_nothing():
    assert hook.select_marker_scripts(False) == []


def test_test_skill_marker_runs_hook_artifact():
    steps = hook.select_marker_scripts(True)
    assert len(steps) == 1
    assert steps[0][-2:] == ["--mode", "hook"]
    assert steps[0][0].endswith("write-artifacts.py")
