"""Tests for scripts/run-tests.py pure helpers (testmon selection parsing)."""

import itertools

import pytest
from conftest import REPO_ROOT, load_module

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
    assert rt.parse_cli_args([]) == (False, None, [])


def test_parse_cli_args_changed_and_target_separate_args():
    assert rt.parse_cli_args(["--changed", "--target", "hook-tests"]) == (True, "hook-tests", [])


def test_parse_cli_args_accepts_the_canonical_changed_flag():
    """`--changed` is the spelling devkit, the template, and the Stop hook all use.

    Regression test: this repo only accepted `--fast`, so the vendored Stop hook's
    own remediation line ("Re-run locally: ... python scripts/run-tests.py --changed")
    hit the strict-unknown-argument path and exited 2 at the moment it was meant to
    help. The one workspace-level "Test: Run Suite" task depends on it too.
    """
    assert rt.parse_cli_args(["--changed"]) == (True, None, [])


def test_parse_cli_args_still_accepts_the_deprecated_fast_alias():
    assert rt.parse_cli_args(["--fast"]) == (True, None, [])


def test_parse_cli_args_target_equals_form():
    assert rt.parse_cli_args(["--target=frontend-tests"]) == (False, "frontend-tests", [])


def test_parse_cli_args_all_flag():
    assert rt.parse_cli_args(["--all"]) == (False, "all", [])


def test_parse_cli_args_unknown_arg_raises():
    # An unrecognized flag must never fall through to the default full-suite
    # run (--help once silently started one).
    with pytest.raises(ValueError, match="--helpp"):
        rt.parse_cli_args(["--helpp"])


def test_parse_cli_args_dangling_target_raises():
    with pytest.raises(ValueError, match="--target"):
        rt.parse_cli_args(["--target"])


# --- explicit pytest targets (the vendored Stop hook's calling convention) ---


def test_parse_cli_args_accepts_bare_test_paths():
    """Regression: `stop.py`'s `test_runner_argv` invokes `[run-tests.py, *targets]`.

    A path used to hit the strict-unknown-argument branch, so the Stop gate failed
    with "Unknown argument: tests/integration/test_vanillaland_parity.py" — a
    complaint about this script's CLI, raised over a perfectly valid test file.
    Same vendored-hook/project-runner mismatch as the `--changed`/`--fast` case above.
    """
    assert rt.parse_cli_args(["tests/unit/test_calls.py"]) == (
        False,
        None,
        ["tests/unit/test_calls.py"],
    )


def test_parse_cli_args_accepts_multiple_paths_and_node_ids():
    argv = ["tests/unit/test_a.py", "tests/unit/test_b.py::test_thing"]
    assert rt.parse_cli_args(argv) == (False, None, argv)


def test_parse_cli_args_mixes_flags_and_paths():
    assert rt.parse_cli_args(["--changed", "tests/unit/test_a.py"]) == (
        True,
        None,
        ["tests/unit/test_a.py"],
    )


def test_parse_cli_args_still_rejects_unknown_flags_alongside_paths():
    """Accepting paths must not weaken the flag check into accepting anything."""
    with pytest.raises(ValueError, match="--nope"):
        rt.parse_cli_args(["tests/unit/test_a.py", "--nope"])


def test_target_value_is_not_mistaken_for_a_path():
    assert rt.parse_cli_args(["--target", "pytest"]) == (False, "pytest", [])


# --- scoped command construction ---


def test_scoped_pytest_command_includes_targets_and_addopts():
    cmd = rt.scoped_pytest_command(["tests/unit/test_a.py"])
    assert "tests/unit/test_a.py" in cmd
    # -o addopts= REPLACES pytest.ini, so the paid-tier exclusion must be repeated
    # or a scoped run would silently collect paid tests.
    assert '-m "not paid"' in cmd


def test_scoped_pytest_command_normalises_windows_separators():
    """Paths are handed to pytest inside a Linux container."""
    cmd = rt.scoped_pytest_command(["tests\\unit\\test_a.py"])
    assert "tests/unit/test_a.py" in cmd
    assert "\\" not in cmd


def test_scoped_pytest_command_quotes_paths_with_spaces():
    cmd = rt.scoped_pytest_command(["tests/unit/a b.py"])
    assert "'tests/unit/a b.py'" in cmd


def test_scoped_pytest_command_is_serial():
    """xdist worker startup costs more than it saves on a handful of files."""
    assert "-n auto" not in rt.scoped_pytest_command(["tests/unit/test_a.py"])


def test_ci_scoped_argv_runs_pytest_directly():
    """CI runs app code on the runner — it must not go through docker compose."""
    argv = rt.ci_scoped_argv(["tests/unit/test_a.py"])
    assert argv[:3] == ["python", "-m", "pytest"]
    assert "tests/unit/test_a.py" in argv
    assert "docker" not in argv


def test_help_requested():
    assert rt.help_requested(["--help"]) is True
    assert rt.help_requested(["-h"]) is True
    assert rt.help_requested(["--changed"]) is False
    assert rt.help_requested([]) is False


def test_usage_names_every_valid_target():
    for target in rt._VALID_TARGETS:
        assert target in rt.USAGE


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


def test_successful_sms_send_is_marked_chargeable():
    text = (REPO_ROOT / "tests" / "integration" / "test_telnyx_sandbox.py").read_text(
        encoding="utf-8"
    )
    assert "@pytest.mark.chargeable\n@_needs_sms_numbers\nasync def test_send_sms_sandbox" in text


def test_webhook_e2e_target_runs_only_tunnel_reachability_file():
    for argv in (rt._LOCAL_WEBHOOK_E2E_ARGV, rt._CI_WEBHOOK_E2E_ARGV):
        assert "tests/integration/test_webhook_e2e.py" in argv
        assert "test_telnyx_sandbox.py" not in " ".join(argv)
    assert "-T" in rt._LOCAL_WEBHOOK_E2E_ARGV
    assert "webhook-e2e" in rt._VALID_TARGETS
    assert "webhook-e2e" not in rt._ALL_TARGETS


def test_all_targets_excludes_paid_tiers():
    # "Test: All Suites" runs _ALL_TARGETS; a paid tier there would hit a live
    # provider on every aggregate run. The three paid tiers stay valid opt-in
    # --targets but must never be in the free aggregate.
    paid_targets = {"telnyx-sandbox", "telnyx-chargeable", "live-e2e"}
    assert paid_targets.isdisjoint(rt._ALL_TARGETS)
    assert paid_targets <= rt._VALID_TARGETS
    assert set(rt._ALL_TARGETS) == {
        "pytest",
        "hook-tests",
        "frontend-tests",
        "bundle-budgets",
    }


def test_bundle_budgets_is_a_free_aggregate_target_running_the_build():
    # The dist/ byte budgets (frontend/bundlePolicy.ts) are only enforced by
    # `test:bundle`, which builds first -- so `test:run` cannot reach them and
    # neither could the desktop test task until this target existed. Free (Node
    # only, no provider, no Docker), so it belongs in the aggregate: a budget
    # nobody runs until the PR gate is not a ratchet.
    assert "bundle-budgets" in rt._VALID_TARGETS
    assert "bundle-budgets" in rt._ALL_TARGETS
    assert rt._BUNDLE_BUDGETS_ARGV[-1] == "test:bundle"
    assert "--prefix" in rt._BUNDLE_BUDGETS_ARGV


def test_bundle_budgets_target_dispatches_to_the_bundle_command(monkeypatch):
    seen: list[list[str]] = []

    def fake_run_argv(argv, extra_env=None):
        seen.append(argv)
        return ([], 0)

    monkeypatch.setattr(rt, "run_argv", fake_run_argv)

    results = rt.run_named_target("bundle-budgets")

    assert set(results) == {"bundle-budgets"}
    assert seen == [rt._BUNDLE_BUDGETS_ARGV]


def test_each_paid_tier_runs_only_its_own_tier():
    # A tier task must run ONLY its tier, never re-run the cheaper tiers below it.
    # tier 1: sandbox reads, excludes chargeable.
    assert rt._TELNYX_SANDBOX_MARKER == "sandbox and not chargeable"
    # tier 2: chargeable ONLY -- not the tier-1 sandbox reads.
    assert rt._TELNYX_CHARGEABLE_MARKER == "chargeable"
    # tier 3: live_e2e ONLY, and never the human-attended `manual` variant.
    assert rt._LIVE_E2E_MARKER == "live_e2e and not manual"


def test_live_e2e_argv_clears_addopts_and_runs_on_host():
    # The suite is host-run and ignored by pytest.ini's addopts (--ignore +
    # -m "not paid"); the target must wipe addopts (-o addopts=) or nothing is
    # collected, and it must not shell into the container.
    argv = rt._LIVE_E2E_ARGV
    assert ("-o", "addopts=") in itertools.pairwise(argv)
    assert ("-m", rt._LIVE_E2E_MARKER) in itertools.pairwise(argv)
    assert "docker" not in argv


def test_run_named_target_routes_every_paid_tier(monkeypatch):
    # Each paid tier is reachable as an opt-in --target and returns under its own
    # key. Stub run_argv so no real provider/live call is made.
    monkeypatch.setattr(rt, "run_argv", lambda argv, extra_env=None: ([" ".join(argv)], 0))
    for target in ("telnyx-sandbox", "telnyx-chargeable", "live-e2e"):
        result = rt.run_named_target(target)
        assert set(result) == {target}


def test_run_named_target_routes_webhook_e2e(monkeypatch):
    monkeypatch.setattr(rt, "run_argv", lambda argv, extra_env=None: ([" ".join(argv)], 0))

    result = rt.run_named_target("webhook-e2e")

    assert set(result) == {"webhook-e2e"}
    assert "tests/integration/test_webhook_e2e.py" in result["webhook-e2e"][0][0]


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
