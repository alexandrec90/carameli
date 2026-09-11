"""Tests for scripts/run-tests.py pure helpers (testmon selection parsing)."""

import itertools
import sys

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
    with "Unknown argument: tests/integration/test_legacy_crm_parity.py" — a
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


def test_addopts_mirrors_every_ignore_in_pytest_ini():
    # `_ADDOPTS` is documented as mirroring pytest.ini's addopts, and the override
    # REPLACES that value -- so an ignore present there and missing here is silently
    # re-admitted. `--ignore=tests/local_e2e` was exactly that: the free local-e2e
    # suite, which needs a LegacyCRM IIS host, got collected by every testmon run.
    ini = (REPO_ROOT / "pytest.ini").read_text(encoding="utf-8")
    line = next(ln for ln in ini.splitlines() if ln.startswith("addopts"))
    ignores = {tok for tok in line.split() if tok.startswith("--ignore=")}
    assert ignores, "pytest.ini declares no --ignore; this test is asserting nothing"
    assert ignores <= {tok for tok in rt._ADDOPTS.split() if tok.startswith("--ignore=")}


def test_webhook_e2e_target_demands_a_live_tunnel():
    # The suite skips itself when NGROK_URL names a tunnel that does not answer --
    # that is what keeps a worktree box's inherited NGROK_URL out of the free
    # changed-scope. The DEDICATED reachability run must not inherit that mercy, or
    # it reports an all-skipped green pass.
    argv = rt._LOCAL_WEBHOOK_E2E_ARGV
    assert ("-e", "CARAMELI_REQUIRE_NGROK=1") in itertools.pairwise(argv)
    assert argv.index("-e") < argv.index("app"), "the -e flag must precede the service name"


# ---------------------------------------------------------------------------
# Host fallback tier -- db+redis up, no app container (the ephemeral-box shape)
# ---------------------------------------------------------------------------


def test_parse_host_port_variants():
    assert rt.parse_host_port("0.0.0.0:5432") == "5432"
    assert rt.parse_host_port("[::]:5433\n") == "5433"
    assert rt.parse_host_port("127.0.0.1:15432") == "15432"
    assert rt.parse_host_port("") is None
    assert rt.parse_host_port("no ports published") is None


def test_host_argv_reuses_this_interpreter():
    argv = rt.host_argv("pytest -v -o addopts='-m \"not paid\"' tests/unit")
    assert argv[:3] == [rt.sys.executable, "-m", "pytest"]
    assert argv[-1] == "tests/unit"
    # shlex keeps `-o addopts=...` as one token, quotes and all -- the paid-tier
    # exclusion must survive the host tier or a fallback run collects paid tests.
    assert 'addopts=-m "not paid"' in argv


def test_host_db_fallback_declines_while_the_app_container_is_up(monkeypatch):
    monkeypatch.setattr(rt, "_compose_running_services", lambda root=None: {"app", "db", "redis"})
    monkeypatch.setattr(rt, "host_db_env", lambda root=None: {"DATABASE_URL": "x"})
    assert rt.host_db_fallback() is None


def test_host_db_fallback_declines_when_the_database_is_down(monkeypatch):
    # No app container AND no database is not a tier to fall back to -- the
    # container's own error is the more useful failure.
    monkeypatch.setattr(rt, "_compose_running_services", lambda root=None: set())
    monkeypatch.setattr(rt, "host_db_env", lambda root=None: {"DATABASE_URL": "x"})
    assert rt.host_db_fallback() is None


def test_host_db_fallback_takes_over_when_only_the_app_is_missing(monkeypatch):
    # The ephemeral-box shape the report describes: db+redis up, no app container, and
    # the run used to end at `docker compose exec`'s "No such container".
    monkeypatch.setattr(rt, "_compose_running_services", lambda root=None: {"db", "redis"})
    monkeypatch.setattr(rt, "host_db_env", lambda root=None: {"DATABASE_URL": "postgres://x"})
    assert rt.host_db_fallback() == {"DATABASE_URL": "postgres://x"}


def test_host_db_env_points_at_the_published_ports(monkeypatch):
    monkeypatch.setattr(rt, "_compose_host_port", lambda svc, port, root=None: "15432")
    env = rt.host_db_env()
    for name in rt.CFG.db.url_env:
        assert env[name].endswith(f"@localhost:15432/{rt.CFG.db.name}")
    assert env[rt.CFG.db.redis_env] == "redis://localhost:15432"


def test_host_db_env_is_none_when_a_port_cannot_be_resolved(monkeypatch):
    monkeypatch.setattr(rt, "_compose_host_port", lambda svc, port, root=None: None)
    assert rt.host_db_env() is None


def test_run_local_uses_the_host_tier_without_testmon(monkeypatch):
    # testmon's index lives inside the container's tree, so a host run must not claim
    # a changed-only selection off somebody else's timings.
    monkeypatch.setattr(rt, "host_db_fallback", lambda root=None: {"DATABASE_URL": "postgres://x"})
    monkeypatch.setattr(
        rt, "pick_fast_command", lambda: pytest.fail("testmon probe on the host tier")
    )
    seen: dict = {}
    monkeypatch.setattr(
        rt,
        "run_argv",
        lambda argv, extra_env=None: (seen.update(argv=argv, env=extra_env), ([], 0))[1],
    )

    rt.run_local(changed=True)

    assert seen["env"] == {"DATABASE_URL": "postgres://x"}
    assert "docker" not in seen["argv"]
    assert "--testmon" not in seen["argv"]


def test_run_scoped_uses_the_host_tier(monkeypatch):
    # The tier only exists off-CI: on a runner the app code runs on the runner itself.
    monkeypatch.setattr(rt, "IS_CI", False)
    monkeypatch.setattr(rt, "host_db_fallback", lambda root=None: {"DATABASE_URL": "postgres://x"})
    seen: dict = {}
    monkeypatch.setattr(
        rt,
        "run_argv",
        lambda argv, extra_env=None: (seen.update(argv=argv, env=extra_env), ([], 0))[1],
    )

    rt.run_scoped(["tests/unit/test_x.py"])

    assert seen["env"] == {"DATABASE_URL": "postgres://x"}
    assert seen["argv"][:3] == [rt.sys.executable, "-m", "pytest"]
    assert "tests/unit/test_x.py" in seen["argv"]


def test_run_local_stays_in_the_container_by_default(monkeypatch):
    monkeypatch.setattr(rt, "host_db_fallback", lambda root=None: None)
    monkeypatch.setattr(rt, "pick_fast_command", lambda: "pytest --testmon")
    seen: dict = {}
    monkeypatch.setattr(
        rt,
        "run_argv",
        lambda argv, extra_env=None: (seen.update(argv=argv, env=extra_env), ([], 0))[1],
    )

    rt.run_local(changed=True)

    assert seen["argv"][:3] == ["docker", "compose", "exec"]
    assert seen["env"] is None


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


# ---------------------------------------------------------------------------
# main(): argv validation, dispatch, and the artifact it leaves behind.
#
# It reads `sys.argv` rather than taking an argv, so every test here sets it. The
# runner's real `logs/test-failures.log` is what the agent reads after a run, so
# `REPO_ROOT` is redirected at tmp_path -- a test that wrote the live artifact would
# report a clean suite from a run that never happened.
# ---------------------------------------------------------------------------

_CLEAN = {"pytest": ([], 0)}


@pytest.fixture
def cli(monkeypatch, tmp_path):
    """Invoke `main()` with these args; returns the artifact path it will write."""

    def configure(*args, is_ci: bool = False):
        monkeypatch.setattr(sys, "argv", ["run-tests.py", *args])
        monkeypatch.setattr(rt, "REPO_ROOT", tmp_path)
        monkeypatch.setattr(rt, "IS_CI", is_ci)
        for name in ("run_scoped", "run_all", "run_named_target", "run_local", "run_ci"):
            monkeypatch.setattr(
                rt, name, lambda *a, _n=name: pytest.fail(f"unexpected dispatch to {_n}")
            )
        return tmp_path / "logs" / "test-failures.log"

    return configure


def routes(monkeypatch, name, results=None):
    """Record the dispatch to `name` and answer with a canned results dict."""
    seen = []
    monkeypatch.setattr(rt, name, lambda *a: (seen.append(a), results or _CLEAN)[1])
    return seen


def test_main_prints_usage_for_help(cli, capsys):
    cli("--help")
    assert rt.main() == 0
    assert rt.USAGE in capsys.readouterr().out


def test_main_rejects_an_unknown_flag(cli, capsys):
    # The whole point of parse_cli_args raising: a typo'd flag must not fall through
    # into the default full-suite run, which looks like success from the outside.
    cli("--fastt")
    assert rt.main() == 2
    err = capsys.readouterr().err
    assert "--fastt" in err
    assert rt.USAGE in err


def test_main_rejects_an_unknown_target(cli, capsys):
    cli("--target", "unit")
    assert rt.main() == 2
    err = capsys.readouterr().err
    assert "Unknown --target" in err
    # The message has to name the alternatives; the target list is not guessable.
    for target in rt._VALID_TARGETS:
        assert target in err


def test_main_rejects_changed_with_a_non_pytest_target(cli, capsys):
    assert rt._VALID_TARGETS - {"pytest"}, "no non-pytest target to check against"
    cli("--changed", "--target", "hook-tests")
    assert rt.main() == 2
    assert "--changed only applies" in capsys.readouterr().err


def test_main_rejects_explicit_paths_with_a_non_pytest_target(cli, capsys):
    cli("--target", "frontend-tests", "tests/unit/test_x.py")
    assert rt.main() == 2
    assert "Explicit test paths" in capsys.readouterr().err


def test_main_allows_changed_and_paths_with_the_pytest_target(cli, monkeypatch):
    # The mirror of the two rejections above: --target pytest is the one target both
    # modifiers mean something for, so neither may be refused there.
    cli("--target", "pytest", "tests/unit/test_x.py")
    seen = routes(monkeypatch, "run_scoped")
    assert rt.main() == 0
    assert seen == [(["tests/unit/test_x.py"],)]


def test_main_routes_explicit_paths_to_run_scoped(cli, monkeypatch):
    # This is the vendored Stop hook's calling convention: bare pytest targets.
    artifact = cli("tests/unit/test_x.py", "tests/unit/test_y.py::test_z")
    seen = routes(monkeypatch, "run_scoped")

    assert rt.main() == 0

    assert seen == [(["tests/unit/test_x.py", "tests/unit/test_y.py::test_z"],)]
    # An empty artifact is how this project spells "clean"; a passing run must clear
    # whatever the previous failing run left there.
    assert artifact.read_text(encoding="utf-8") == ""


def test_main_routes_all_to_run_all(cli, monkeypatch):
    cli("--all")
    seen = routes(monkeypatch, "run_all")
    assert rt.main() == 0
    assert seen == [()]


def test_main_routes_a_named_target(cli, monkeypatch):
    cli("--target", "hook-tests")
    seen = routes(monkeypatch, "run_named_target")
    assert rt.main() == 0
    assert seen == [("hook-tests",)]


@pytest.mark.parametrize(("args", "changed"), [((), False), (("--changed",), True)])
def test_main_runs_the_local_suite_by_default(cli, monkeypatch, args, changed):
    cli(*args)
    seen = routes(monkeypatch, "run_local")
    assert rt.main() == 0
    assert seen == [(changed,)]


def test_main_runs_the_ci_suite_when_ci_is_set(cli, monkeypatch):
    cli(is_ci=True)
    seen = routes(monkeypatch, "run_ci")
    assert rt.main() == 0
    assert seen == [()]


def test_main_fails_and_writes_the_failures_to_the_artifact(cli, monkeypatch):
    artifact = cli()
    routes(
        monkeypatch,
        "run_local",
        {"pytest": (["FAILED tests/unit/test_x.py::test_boom - AssertionError: no"], 1)},
    )

    assert rt.main() == 1

    text = artifact.read_text(encoding="utf-8")
    assert "# pytest" in text
    assert "test_boom" in text


def test_main_fails_when_a_critical_target_was_skipped(cli, monkeypatch, capsys):
    # A suite that never started is not a pass. digest_tests leaves `any_failed`
    # False for an environmental skip on purpose and hands the decision here, so
    # this is main's own judgement, not a pass-through.
    artifact = cli()
    routes(monkeypatch, "run_local", {"pytest": (["pytest: command not found"], 1)})

    assert rt.main() == 1

    assert "was skipped" in capsys.readouterr().out
    # And the artifact says so too, rather than reading as clean.
    assert "DID NOT RUN" in artifact.read_text(encoding="utf-8")


def test_main_is_green_when_a_non_critical_target_was_skipped(cli, monkeypatch):
    # The other side of that call: a paid tier with no credentials is ordinary, and
    # failing the run on it would make every local run red.
    cli("--target", "telnyx-sandbox")
    routes(
        monkeypatch,
        "run_named_target",
        {"telnyx-sandbox": (["telnyx: command not found"], 1)},
    )
    assert rt.main() == 0


def test_main_on_ci_splits_frontend_failures_into_their_own_artifact(cli, monkeypatch, tmp_path):
    # Backend and frontend failures are triaged separately, so a vitest failure must
    # not land in the backend artifact -- and must still fail the run.
    backend = cli(is_ci=True)
    routes(
        monkeypatch,
        "run_ci",
        {"frontend-tests": (["FAIL src/tests/skins/panelGeometry.test.ts > it breaks"], 1)},
    )

    assert rt.main() == 1

    frontend = tmp_path / "logs" / "frontend-test-failures.log"
    assert "# frontend-tests" in frontend.read_text(encoding="utf-8")
    assert backend.read_text(encoding="utf-8") == ""
