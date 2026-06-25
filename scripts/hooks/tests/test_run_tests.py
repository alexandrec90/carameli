"""Tests for scripts/run-tests.py pure helpers (testmon selection parsing)."""

from conftest import load_module

rt = load_module("scripts/run-tests.py")


def test_parse_testmon_selection_normal():
    assert rt.parse_testmon_selection("SEL=12 selected|TOT=200 tests collected in 1.2s") == (
        12,
        200,
    )


def test_parse_testmon_selection_zero_selected():
    selected, total = rt.parse_testmon_selection("SEL=0 selected|TOT=200 tests collected")
    assert selected == 0
    assert total == 200


def test_parse_testmon_selection_defaults_when_unparseable():
    # Unknown selection -> 999 (force full run); unknown total -> 1 (no div-by-zero).
    assert rt.parse_testmon_selection("SEL=|TOT=") == (999, 1)


def test_parse_testmon_selection_missing_total_defaults_to_one():
    selected, total = rt.parse_testmon_selection("SEL=5 selected|TOT=garbage")
    assert selected == 5
    assert total == 1


def test_parse_cli_args_default():
    assert rt.parse_cli_args([]) == (False, None)


def test_parse_cli_args_fast_and_target_separate_args():
    assert rt.parse_cli_args(["--fast", "--target", "hook-tests"]) == (True, "hook-tests")


def test_parse_cli_args_target_equals_form():
    assert rt.parse_cli_args(["--target=frontend-tests"]) == (False, "frontend-tests")


def test_parse_cli_args_all_flag():
    assert rt.parse_cli_args(["--all"]) == (False, "all")


def test_run_all_merges_every_target(monkeypatch):
    # run_all must run each of the four targets and merge them into one results
    # dict, so main() writes the shared artifact exactly once (no racing writers).
    calls: list[str] = []

    def fake_run_named_target(target):
        calls.append(target)
        return {target: ([f"{target} output"], 0)}

    monkeypatch.setattr(rt, "run_named_target", fake_run_named_target)

    results = rt.run_all()

    assert sorted(calls) == sorted(rt._ALL_TARGETS)
    assert set(results) == set(rt._ALL_TARGETS)
    assert results["pytest"] == (["pytest output"], 0)


def test_run_all_preserves_failure_codes(monkeypatch):
    # A passing target must not blank out a failing one -- both survive the merge.
    def fake_run_named_target(target):
        code = 1 if target == "frontend-tests" else 0
        return {target: ([f"{target}"], code)}

    monkeypatch.setattr(rt, "run_named_target", fake_run_named_target)

    results = rt.run_all()

    assert results["frontend-tests"][1] == 1
    assert results["pytest"][1] == 0


def test_resolve_argv_windows_npm_cmd(monkeypatch):
    monkeypatch.setattr(rt.os, "name", "nt")
    monkeypatch.setattr(
        rt.shutil,
        "which",
        lambda name: r"C:\Program Files\nodejs\npm.cmd" if name == "npm.cmd" else None,
    )
    assert rt.resolve_argv(["npm", "--prefix", "frontend", "run", "test:run"]) == [
        r"C:\Program Files\nodejs\npm.cmd",
        "--prefix",
        "frontend",
        "run",
        "test:run",
    ]


def test_resolve_argv_non_windows_unchanged(monkeypatch):
    monkeypatch.setattr(rt.os, "name", "posix")
    assert rt.resolve_argv(["npm", "run", "test:run"]) == ["npm", "run", "test:run"]
