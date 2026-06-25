"""Unit tests for the PreToolUse dispatcher's marker selection."""

from conftest import load_module

hook = load_module("scripts/hooks/pretool.py")


def test_no_markers_selects_nothing():
    assert hook.select_marker_scripts(False, False) == []


def test_test_skill_marker_runs_hook_artifact():
    steps = hook.select_marker_scripts(True, False)
    assert len(steps) == 1
    assert steps[0][-2:] == ["--mode", "hook"]
    assert steps[0][0].endswith("write-artifacts.py")


def test_fix_tests_marker_runs_restart():
    steps = hook.select_marker_scripts(False, True)
    assert len(steps) == 1
    assert steps[0][0].endswith("restart-if-app-diff.py")


def test_both_markers_run_in_order():
    steps = hook.select_marker_scripts(True, True)
    assert [s[0].split("/")[-1].split("\\")[-1] for s in steps] == [
        "write-artifacts.py",
        "restart-if-app-diff.py",
    ]
