"""Tests for scripts/run-tests.py pure helpers (testmon selection parsing)."""

import itertools

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


def test_telnyx_sandbox_argvs_exclude_chargeable_tests():
    # Money guardrail: with live credentials, the chargeable provision test buys
    # a real phone number. Neither routine runner path may ever include it. The
    # `sandbox and not chargeable` marker also opts back in over the global
    # `-m "not paid"` default so the dedicated task still runs the tier-1 reads.
    for argv in (rt._LOCAL_TELNYX_SANDBOX_ARGV, rt._CI_TELNYX_SANDBOX_ARGV):
        # Adjacent-pair check: the CI argv also contains `python -m pytest`,
        # so a bare index("-m") would find the wrong flag.
        assert ("-m", "sandbox and not chargeable") in itertools.pairwise(argv)
        assert "not chargeable" in rt._TELNYX_SANDBOX_MARKER


def test_all_targets_excludes_paid_tiers():
    # "Test: All Suites" runs _ALL_TARGETS; a paid tier there would hit a live
    # provider on every aggregate run. telnyx-sandbox stays a valid opt-in
    # --target but must never be in the free aggregate.
    assert "telnyx-sandbox" not in rt._ALL_TARGETS
    assert "telnyx-sandbox" in rt._VALID_TARGETS
    assert set(rt._ALL_TARGETS) == {"pytest", "hook-tests", "frontend-tests"}


def test_addopts_excludes_paid_by_default():
    # The testmon `-o addopts=` override REPLACES pytest.ini's addopts, so the
    # paid-tier exclusion must be repeated here or fast mode collects paid tests.
    assert '-m "not paid"' in rt._ADDOPTS


# ---------------------------------------------------------------------------
# critical_skip_lines -- a skipped backend suite must fail the run, not pass it
# ---------------------------------------------------------------------------


def test_critical_skip_lines_pytest_not_installed():
    lines = rt.critical_skip_lines([("pytest", "not installed")])
    assert len(lines) == 2
    assert "[FAIL]" in lines[0] and "'pytest'" in lines[0] and "did NOT run" in lines[0]
    # The fix hint must be a runnable command (diagnostics.md section 5 spirit).
    assert "pip install -r requirements-dev.txt" in lines[1]


def test_critical_skip_lines_pytest_environment_error():
    # Environment errors (stack down) still fail the run, but the pip-install
    # hint would be wrong -- only the FAIL line is emitted.
    lines = rt.critical_skip_lines([("pytest", "environment error")])
    assert len(lines) == 1
    assert "[FAIL]" in lines[0] and "environment error" in lines[0]


def test_critical_skip_lines_ignores_non_critical_targets():
    assert rt.critical_skip_lines([("telnyx-sandbox", "not installed")]) == []


def test_critical_skip_lines_empty():
    assert rt.critical_skip_lines([]) == []
