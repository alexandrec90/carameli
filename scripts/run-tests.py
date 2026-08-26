#!/usr/bin/env python3
"""Runs the test suite and writes only the failures to `logs/test-failures.log`
for AI-agent consumption. On pass, clears the artifact.

One entrypoint for every environment:
  - **Local desktop:** `python scripts/run-tests.py` runs the full suite inside
    the app container (xdist). `--changed` runs the changed-only set via testmon,
    falling back to a full xdist run (with --testmon-noselect) when testmon
    selects more than half the suite. `--all` runs every FREE target (pytest,
    hook, frontend) in one process and merges them into a single artifact, so
    the aggregate VS Code task no longer fans out into racing writers. Paid tiers
    (telnyx-sandbox and the live_e2e suite) are excluded from `--all` and run only
    via their own opt-in tasks -- no aggregate or CI path touches a live provider.
  - **CI (GitHub Actions):** `python scripts/run-tests.py` with `CI=true` runs
    pytest + hook tests + frontend tests directly on the runner (no Docker stack).
    Backend failures go to `logs/test-failures.log`; frontend (vitest) failures
    are split into `logs/frontend-test-failures.log` so backend and frontend
    failures can be triaged separately. All fixing happens locally.

Filtering / artifact format live in `scripts/diagnostics.py` (shared with
`scripts/lint-all.py`), so local and CI never drift.
"""

import math
import os
import re
import shlex
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import diagnostics
import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]
IS_CI = bool(os.environ.get("CI"))

# Mirrors pytest.ini's addopts: the `-o addopts=` override below REPLACES the ini
# value, so the paid-tier exclusion (-m "not paid") and the dir ignores must be
# repeated here or testmon fast-mode would silently collect paid tests.
_ADDOPTS = (
    "--ignore=tests/e2e --ignore=tests/live_e2e --ignore=tests/local_e2e "
    '--ignore=tests/load --ignore=tests/quarantine -m "not paid"'
)
_PYTEST_FULL = "pytest -v --tb=short --no-header --color=no --durations=20 -n auto --dist=worksteal"
_PYTEST_TESTMON = (
    f"pytest -v --tb=short --no-header --color=no --durations=20 -o addopts='{_ADDOPTS}' --testmon"
)
_PYTEST_XDIST_NOSELECT = _PYTEST_FULL + " --testmon-noselect"

# CI runs a curated subset directly (the app code runs on the runner, not in a
# container) -- matches what .github/workflows/on-demand.yml ran historically.
_CI_PYTEST_ARGV = [
    "python",
    "-m",
    "pytest",
    "tests/unit/",
    "tests/integration/test_full_flows.py",
    "tests/integration/test_contract.py",
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
_CI_HOOK_ARGV = ["python", "-m", "pytest", "scripts/hooks/tests", "-q", "--color=no"]
_CI_FRONTEND_ARGV = ["npm", "--prefix", "frontend", "run", "test:run"]
_LOCAL_HOOK_ARGV = ["python", "-m", "pytest", "scripts/hooks/tests", "-q", "--color=no"]
_LOCAL_FRONTEND_ARGV = ["npm", "--prefix", "frontend", "run", "test:run"]
# `test:bundle` builds first, then measures what the build produced against the
# ratchets in frontend/bundlePolicy.ts -- the same command on CI and locally,
# since it needs Node and nothing else. Kept as its own target rather than
# folded into `frontend-tests`: a failing unit test and a blown byte budget want
# different fixes, and `test:run` must stay runnable on an unbuilt tree.
_BUNDLE_BUDGETS_ARGV = ["npm", "--prefix", "frontend", "run", "test:bundle"]
_LOCAL_WEBHOOK_E2E_ARGV = [
    "docker",
    "compose",
    "exec",
    "-T",
    # The dedicated target is the one run that must NOT tolerate a dead tunnel:
    # `tests/integration/test_webhook_e2e.py` skips itself when NGROK_URL names a
    # tunnel that does not answer, which is what keeps a worktree box's inherited
    # NGROK_URL out of the free changed-scope. Here that skip would be an
    # all-skipped green pass, so this flag turns it back into a failure.
    "-e",
    "CARAMELI_REQUIRE_NGROK=1",
    "app",
    "pytest",
    "tests/integration/test_webhook_e2e.py",
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
_CI_WEBHOOK_E2E_ARGV = [
    "python",
    "-m",
    "pytest",
    "tests/integration/test_webhook_e2e.py",
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
# The telnyx-sandbox target is an explicit opt-in tier -- it is deliberately absent
# from _ALL_TARGETS so the
# free "Test: All Suites" aggregate never touches a live provider. The `-m` here
# is `sandbox and not chargeable`: `sandbox` opts back in over the global
# `-m "not paid"` default (see _ADDOPTS / pytest.ini), while `not chargeable`
# still excludes tier-2 tests that buy a real number, send real SMS, or wait for
# delivery callbacks. Run those manually with `-m chargeable`.
_TELNYX_SANDBOX_MARKER = "sandbox and not chargeable"
_LOCAL_TELNYX_SANDBOX_ARGV = [
    "docker",
    "compose",
    "exec",
    "-T",
    "-e",
    "TELNYX_SANDBOX=1",
    "app",
    "pytest",
    "tests/integration/test_telnyx_sandbox.py",
    "-m",
    _TELNYX_SANDBOX_MARKER,
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
_CI_TELNYX_SANDBOX_ARGV = [
    "python",
    "-m",
    "pytest",
    "tests/integration/test_telnyx_sandbox.py",
    "-m",
    _TELNYX_SANDBOX_MARKER,
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
# telnyx-chargeable -- PAID tier 2, opt-in only. `-m chargeable` selects ONLY the
# money-spending tests (buys a DID, sends real SMS); it does NOT re-run the tier-1
# sandbox reads. `chargeable` opts back in over the global `-m "not paid"` default.
_TELNYX_CHARGEABLE_MARKER = "chargeable"
_LOCAL_TELNYX_CHARGEABLE_ARGV = [
    "docker",
    "compose",
    "exec",
    "-T",
    "-e",
    "TELNYX_SANDBOX=1",
    "app",
    "pytest",
    "tests/integration/test_telnyx_sandbox.py",
    "-m",
    _TELNYX_CHARGEABLE_MARKER,
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
_CI_TELNYX_CHARGEABLE_ARGV = [
    "python",
    "-m",
    "pytest",
    "tests/integration/test_telnyx_sandbox.py",
    "-m",
    _TELNYX_CHARGEABLE_MARKER,
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
# live-e2e -- PAID tier 3, opt-in only. Runs ONLY the live suite (real infra, real
# money) and excludes `manual` (needs a human to answer). Runs on the host, not in
# the container: the suite observes the live stack from outside (see
# tests/live_e2e/conftest.py). `-o addopts=` wipes pytest.ini's addopts so its
# `--ignore=tests/live_e2e` and `-m "not paid"` defaults don't deselect the suite;
# `-m "live_e2e and not manual"` then selects exactly this tier.
_LIVE_E2E_MARKER = "live_e2e and not manual"
_LIVE_E2E_ARGV = [
    "python",
    "-m",
    "pytest",
    "tests/live_e2e",
    "-o",
    "addopts=",
    "-m",
    _LIVE_E2E_MARKER,
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
_VALID_TARGETS = {
    "pytest",
    "hook-tests",
    "frontend-tests",
    "bundle-budgets",
    "webhook-e2e",
    "telnyx-sandbox",
    "telnyx-chargeable",
    "live-e2e",
}
# Targets whose silent skip invalidates the whole run. A dedicated reachability
# run with no NGROK_URL must fail instead of reporting an all-skipped green pass.
_CRITICAL_TARGETS = {"pytest", "webhook-e2e"}
# Order is cosmetic only (results are merged into one dict); pytest first so its
# "Running pytest..." banner leads the interleaved output. Only FREE targets
# belong here: `run-tests.py --all` runs this set, so a paid tier (telnyx-sandbox,
# a valid opt-in --target) must never be added -- it would hit a live provider on
# every aggregate run. Paid tiers are opt-in via their own dedicated tasks.
_ALL_TARGETS = ("pytest", "hook-tests", "frontend-tests", "bundle-budgets")
_WINDOWS_BATCH_LAUNCHERS = {"npm", "npx", "vite"}


def resolve_argv(argv: list[str]) -> list[str]:
    """Rewrite Windows batch launchers to their `.cmd` shim when available."""
    if not argv or os.name != "nt":
        return argv

    exe = argv[0]
    if exe.lower() not in _WINDOWS_BATCH_LAUNCHERS:
        return argv

    resolved = shutil.which(f"{exe}.cmd")
    if not resolved:
        return argv

    return [resolved, *argv[1:]]


def run_argv(argv: list[str], extra_env: dict[str, str] | None = None) -> tuple[list[str], int]:
    """Run a command from the repo root, merging stdout+stderr in order.

    Argv form (no shell) so multi-line bash passed to `docker compose exec`
    survives without cross-platform quoting hazards.
    """
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    argv = resolve_argv(argv)
    p = subprocess.run(
        argv,
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (p.stdout or "").splitlines(), p.returncode


def _in_container(bash_cmd: str) -> list[str]:
    return ["docker", "compose", "exec", "-T", "app", "bash", "-c", bash_cmd]


# ---------------------------------------------------------------------------
# Host fallback tier. The app container is the normal home for pytest, but an
# ephemeral worktree box routinely has db+redis up and no app container -- and the
# run then ended at `docker compose exec`'s "No such container", which
# `diagnostics.get_skip_reason` classifies as an environmental skip. The suite is
# perfectly runnable there: `.devkit.toml [db]` already describes how to reach db and
# redis over their published compose ports, which is what the stop hook's own DB tier
# uses. Try that before giving up.
# ---------------------------------------------------------------------------

sys.path.insert(0, str(REPO_ROOT / "scripts" / "hooks"))
import harness_config  # noqa: E402 -- needs the sys.path line above

CFG = harness_config.load(REPO_ROOT)


def _compose_running_services(repo_root: Path = REPO_ROOT) -> set[str]:
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--services", "--status", "running"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    return set(result.stdout.split()) if result.returncode == 0 else set()


def parse_host_port(output: str) -> str | None:
    """Host port from `docker compose port` output ('0.0.0.0:5432', '[::]:5432'). Pure."""
    line = next((ln for ln in reversed(output.splitlines()) if ln.strip()), "")
    if ":" not in line:
        return None
    port = line.rsplit(":", 1)[1].strip()
    return port if port.isdigit() else None


def _compose_host_port(
    service: str, container_port: int, repo_root: Path = REPO_ROOT
) -> str | None:
    try:
        result = subprocess.run(
            ["docker", "compose", "port", service, str(container_port)],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_host_port(result.stdout) if result.returncode == 0 else None


def host_db_env(repo_root: Path = REPO_ROOT) -> dict[str, str] | None:
    """Env pointing host pytest at db+redis over their published ports, or None when
    a port cannot be resolved (the containers are not actually up)."""
    db = CFG.db
    db_port = _compose_host_port(db.db_service, db.db_port, repo_root)
    redis_port = _compose_host_port(db.redis_service, db.redis_port, repo_root)
    if not db_port or not redis_port:
        return None
    db_url = f"{db.url_scheme}://{db.user}:{db.password}@localhost:{db_port}/{db.name}"
    env: dict[str, str] = {name: db_url for name in db.url_env}
    env[db.redis_env] = f"redis://localhost:{redis_port}"
    # `[db].name` is a disposable database on purpose -- the suite TRUNCATEs every
    # table in whatever DATABASE_URL names.
    for name, default in db.test_env.items():
        env[name] = os.environ.get(name, default)
    return env


def host_db_fallback(repo_root: Path = REPO_ROOT) -> dict[str, str] | None:
    """The env for the host tier, or None to stay with the app container.

    None whenever the container tier is the right answer -- the app service is up, the
    project has no `[db]` tier, or db/redis are not both running. Never guesses: with
    no reachable database the container's own error is the more useful failure.
    """
    if not CFG.db.enabled:
        return None
    running = _compose_running_services(repo_root)
    if "app" in running or not set(CFG.db.services).issubset(running):
        return None
    return host_db_env(repo_root)


def host_argv(bash_cmd: str) -> list[str]:
    """The in-container `pytest ...` command as host argv. Pure.

    `sys.executable -m pytest`, not a bare `pytest`: the box's venv is not on PATH
    (provisioning does not activate it), so the interpreter running this script is the
    only reliable way back to the project's own pytest.
    """
    parts = shlex.split(bash_cmd)
    if parts and parts[0] == "pytest":
        return [sys.executable, "-m", "pytest", *parts[1:]]
    return parts


def parse_testmon_selection(dual_out: str) -> tuple[int, int]:
    """Parse `SEL=<x>|TOT=<y>` collect output into (selected, total) counts.

    Defaults are conservative: unknown selection -> 999 (force a full run),
    unknown total -> 1 (avoid divide-by-zero).
    """
    selected, total = 999, 1
    sel = re.search(r"SEL=([^|]*)", dual_out)
    if sel:
        m = re.search(r"(\d+)\s+(selected|test)", sel.group(1))
        if m:
            selected = int(m.group(1))
    tot = re.search(r"TOT=(.*)$", dual_out)
    if tot:
        m = re.search(r"(\d+)\s+(selected|test)", tot.group(1))
        if m:
            total = int(m.group(1))
    return selected, total


USAGE = """usage: python scripts/run-tests.py [--changed] [--all] [--target <name>] [PATH ...]

  (no args)        full backend suite (in-container xdist locally; direct on CI)
  --changed        changed-only via testmon, xdist fallback (default suite only)
                   (--fast is a deprecated alias)
  --all            every FREE target (pytest, hook-tests, frontend-tests,
                   bundle-budgets)
  --target <name>  one of: pytest, hook-tests, frontend-tests, bundle-budgets,
                   webhook-e2e, telnyx-sandbox, telnyx-chargeable, live-e2e
  PATH ...         pytest targets (file, dir, or path::node_id); overrides the
                   suite selection. This is how the vendored Stop hook invokes
                   the runner.

Failures are written to logs/test-failures.log (frontend split out on CI)."""


def help_requested(argv: list[str]) -> bool:
    """True when the args ask for usage. Pure."""
    return "-h" in argv or "--help" in argv


def parse_cli_args(argv: list[str]) -> tuple[bool, str | None, list[str]]:
    """Return (`changed`, `target`, `paths`) from the CLI args.

    Raises ValueError on any unrecognized *flag* — an unknown flag falling
    through must never start the default full-suite run. Non-flag arguments are
    pytest targets (paths or `path::node_id`), not errors: the vendored Stop hook
    invokes this script as `[run-tests.py, *targets]` (`stop.py`'s
    `test_runner_argv`), because its fallback path is a bare `-m pytest`, which
    takes paths. A runner that rejects them makes the Stop gate fail with
    "Unknown argument: tests/..." — a message about *this script's* CLI, for a
    test file that is perfectly fine — and the agent then debugs the wrong thing.

    This is the second instance of that same mismatch; see the `--changed`/`--fast`
    note below for the first. Both come from the vendored hook and the project
    runner disagreeing about the calling convention, so both fixes belong here, in
    the project-owned half.

    `--changed` is the canonical spelling, shared with devkit and every generated
    project so the one workspace-level "Test: Run Suite" task works everywhere.
    It is also what the vendored Stop hook already tells the agent to run
    ("Re-run locally: ... python scripts/run-tests.py --changed") — this repo spelled
    it `--fast`, so that advice hit the strict-argument path above and died on
    "Unknown argument: --changed" at exactly the moment it was meant to help.
    `--fast` stays as a deprecated alias so existing muscle memory and any prose that
    still names it keep working.
    """
    changed = False
    target: str | None = None
    paths: list[str] = []

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("--changed", "--fast", "-Fast"):
            changed = True
        elif arg == "--all":
            target = "all"
        elif arg.startswith("--target="):
            target = arg.split("=", 1)[1]
        elif arg == "--target" and i + 1 < len(argv):
            target = argv[i + 1]
            i += 1
        elif arg.startswith("-"):
            raise ValueError(f"Unknown argument: {arg}")
        else:
            paths.append(arg)
        i += 1

    return changed, target, paths


def pick_fast_command() -> str:
    """Decide testmon vs xdist-fallback by collecting both counts in one exec."""
    dual = (
        f"S=$(pytest --collect-only -q -o addopts='{_ADDOPTS}' --testmon 2>/dev/null | tail -1)\n"
        f"T=$(pytest --collect-only -q -o addopts='{_ADDOPTS}' 2>/dev/null | tail -1)\n"
        'echo "SEL=${S}|TOT=${T}"'
    )
    print("  Checking testmon selection...")
    lines, _ = run_argv(_in_container(dual))
    last = next((l for l in reversed(lines) if l.strip()), "")
    selected, total = parse_testmon_selection(last)
    if total > 0 and selected > math.ceil(total / 2):
        print(f"  testmon selected {selected}/{total} tests -- falling back to xdist")
        return _PYTEST_XDIST_NOSELECT
    print(f"  testmon: {selected}/{total} tests selected")
    return _PYTEST_TESTMON


def scoped_pytest_command(paths: list[str]) -> str:
    """The in-container pytest command for an explicit target list. Pure.

    Serial (no `-n auto`): a handful of named files is slower under xdist's worker
    startup than without it. `_ADDOPTS` is repeated for the same reason it is in
    `_PYTEST_TESTMON` — `-o addopts=` REPLACES pytest.ini's value, so omitting it
    would silently re-admit the paid tiers the global `-m "not paid"` excludes.
    """
    quoted = " ".join(shlex.quote(p.replace("\\", "/")) for p in paths)
    return f"pytest -v --tb=short --no-header --color=no -o addopts='{_ADDOPTS}' {quoted}"


def ci_scoped_argv(paths: list[str]) -> list[str]:
    """Direct (non-container) pytest argv for explicit targets on CI. Pure.

    CI runs the app code on the runner, so it must not go through
    `docker compose exec` the way `run_local` does.
    """
    return ["python", "-m", "pytest", *paths, "-v", "--tb=short", "--no-header", "--color=no"]


def run_scoped(paths: list[str]) -> dict[str, tuple[list[str], int]]:
    """Run pytest against an explicit target list, in-container or direct per env."""
    print(f"\nRunning pytest -- scoped ({len(paths)} target(s)) ...")
    if IS_CI:
        return {"pytest": run_argv(ci_scoped_argv(paths))}
    cmd = scoped_pytest_command(paths)
    host_env = host_db_fallback()
    if host_env is not None:
        print(_HOST_TIER_NOTE)
        return {"pytest": run_argv(host_argv(cmd), extra_env=host_env)}
    return {"pytest": run_argv(_in_container(cmd))}


_HOST_TIER_NOTE = (
    "  no app container -- running on the host against db+redis over their published ports"
)


def run_local(changed: bool) -> dict[str, tuple[list[str], int]]:
    host_env = host_db_fallback()
    if host_env is not None:
        # Always the full free suite here, never testmon: `.testmondata` is written
        # inside the container's tree, so a host run would select against a database
        # of somebody else's timings -- and "changed-only" off a stale index is the
        # one failure that reports green having run the wrong tests.
        print("\nRunning pytest -- full (parallel, xdist) ...")
        print(_HOST_TIER_NOTE)
        lines, code = run_argv(host_argv(_PYTEST_FULL), extra_env=host_env)
        return {"pytest": (lines, code)}
    pytest_cmd = pick_fast_command() if changed else _PYTEST_FULL
    mode = "changed-only (testmon)" if changed else "full (parallel, xdist)"
    print(f"\nRunning pytest -- {mode} ...")
    lines, code = run_argv(_in_container(pytest_cmd))
    return {"pytest": (lines, code)}


def run_named_target(target: str) -> dict[str, tuple[list[str], int]]:
    """Run one named test target through the shared diagnostics pipeline."""
    if target == "pytest":
        return run_local(False) if not IS_CI else {"pytest": run_argv(_CI_PYTEST_ARGV)}
    if target == "hook-tests":
        return {"hook-tests": run_argv(_CI_HOOK_ARGV if IS_CI else _LOCAL_HOOK_ARGV)}
    if target == "frontend-tests":
        return {"frontend-tests": run_argv(_CI_FRONTEND_ARGV if IS_CI else _LOCAL_FRONTEND_ARGV)}
    if target == "bundle-budgets":
        return {"bundle-budgets": run_argv(_BUNDLE_BUDGETS_ARGV)}
    if target == "webhook-e2e":
        argv = _CI_WEBHOOK_E2E_ARGV if IS_CI else _LOCAL_WEBHOOK_E2E_ARGV
        env = {"CARAMELI_REQUIRE_NGROK": "1"} if IS_CI else None
        return {"webhook-e2e": run_argv(argv, extra_env=env)}
    if target == "telnyx-sandbox":
        argv = _CI_TELNYX_SANDBOX_ARGV if IS_CI else _LOCAL_TELNYX_SANDBOX_ARGV
        env = {"TELNYX_SANDBOX": "1"} if IS_CI else None
        return {"telnyx-sandbox": run_argv(argv, extra_env=env)}
    if target == "telnyx-chargeable":
        argv = _CI_TELNYX_CHARGEABLE_ARGV if IS_CI else _LOCAL_TELNYX_CHARGEABLE_ARGV
        env = {"TELNYX_SANDBOX": "1"} if IS_CI else None
        return {"telnyx-chargeable": run_argv(argv, extra_env=env)}
    if target == "live-e2e":
        # Host-run (not in-container); RUN_LIVE_E2E=1 satisfies the suite's skip
        # gate, and the E2E_* vars come from the caller's environment/.env.
        return {"live-e2e": run_argv(_LIVE_E2E_ARGV, extra_env={"RUN_LIVE_E2E": "1"})}
    raise ValueError(f"Unknown test target: {target}")


def run_all() -> dict[str, tuple[list[str], int]]:
    """Run every local test target in one process, merging into one results dict.

    The shared `logs/test-failures.log` artifact is then written exactly once by
    `main()`. This replaces fanning the targets out into separate VS Code tasks,
    which raced on (and clobbered) that single artifact -- a passing target would
    blank the file out from under a failing one. Targets run concurrently in
    threads (each is subprocess-bound), so the aggregate keeps the parallelism the
    fan-out had.
    """
    print("\nRunning all targets: " + ", ".join(_ALL_TARGETS) + " ...")
    results: dict[str, tuple[list[str], int]] = {}
    with ThreadPoolExecutor(max_workers=len(_ALL_TARGETS)) as pool:
        futures = [pool.submit(run_named_target, target) for target in _ALL_TARGETS]
        for future in as_completed(futures):
            results.update(future.result())
    return results


def critical_skip_lines(skips: list[tuple[str, str]]) -> list[str]:
    """Loud terminal lines for skipped targets that invalidate the run. Pure.

    Environment noise stays out of the artifact,
    but a skipped critical target must still fail the run: the caller treats a
    non-empty return as a failure.
    """
    lines: list[str] = []
    for name, reason in skips:
        if name not in _CRITICAL_TARGETS:
            continue
        lines.append(f"[FAIL] target '{name}' was skipped ({reason}) -- its tests did NOT run.")
        if reason == "not installed":
            lines.append(
                "  fix: docker compose exec -T app pip install -r requirements-dev.txt"
                " (durable: rebuild -- docker compose build app)"
            )
    return lines


def run_ci() -> dict[str, tuple[list[str], int]]:
    print("\nRunning pytest + hook tests + frontend tests + bundle budgets (CI)...")
    return {
        "pytest": run_argv(_CI_PYTEST_ARGV),
        "hook-tests": run_argv(_CI_HOOK_ARGV),
        "frontend-tests": run_argv(_CI_FRONTEND_ARGV),
        "bundle-budgets": run_argv(_BUNDLE_BUDGETS_ARGV),
    }


def main() -> int:
    if help_requested(sys.argv[1:]):
        print(USAGE)
        return 0
    try:
        changed, target, paths = parse_cli_args(sys.argv[1:])
    except ValueError as exc:
        print(exc, file=sys.stderr)
        print(USAGE, file=sys.stderr)
        return 2
    if target and target != "all" and target not in _VALID_TARGETS:
        print(
            "Unknown --target. Expected one of: " + ", ".join(sorted(_VALID_TARGETS)),
            file=sys.stderr,
        )
        return 2
    if target and changed and target != "pytest":
        print(
            "--changed only applies to the default pytest suite or --target pytest.",
            file=sys.stderr,
        )
        return 2
    if paths and target and target != "pytest":
        print(
            "Explicit test paths only apply to the default pytest suite or --target pytest.",
            file=sys.stderr,
        )
        return 2

    label = "scripts/run-tests.py (CI)" if IS_CI else "scripts/run-tests.py (local)"

    artifact = REPO_ROOT / "logs" / "test-failures.log"
    target_line = [f"Target   : {target}"] if target else []
    if paths:
        target_line.append(f"Scope    : {len(paths)} explicit target(s)")
    script_common.print_suite_header("Test Suite", artifact, target_line)

    if paths:
        results = run_scoped(paths)
    elif target == "all":
        results = run_all()
    elif target:
        results = run_named_target(target)
    else:
        results = run_ci() if IS_CI else run_local(changed)

    if IS_CI:
        # Split frontend (vitest) failures into their own artifact so backend and
        # frontend failures are triaged separately. Both are fixed locally; the
        # on-demand workflow gates on both logs and uploads them as run artifacts.
        any_failed, text, skips = diagnostics.digest_tests(
            results, label, include=diagnostics.BACKEND_TEST_TARGETS
        )
        fe_failed, fe_text, fe_skips = diagnostics.digest_tests(
            results, label, include=diagnostics.FRONTEND_TEST_TARGETS
        )
        frontend_artifact = REPO_ROOT / "logs" / "frontend-test-failures.log"
        frontend_artifact.parent.mkdir(parents=True, exist_ok=True)
        frontend_artifact.write_text(fe_text, encoding="utf-8")
        skips = skips + fe_skips
        if fe_failed:
            any_failed = True
            print(f"\nFrontend (vitest) failures written to: {frontend_artifact}")
            print("  (inspect the artifact above and fix locally)")
    else:
        any_failed, text, skips = diagnostics.digest_tests(results, label)

    critical = critical_skip_lines(skips)
    if critical:
        any_failed = True
        print()
        for line in critical:
            print(line)

    skipped = {s for s, _ in skips}
    statuses = [
        (script_common.FAIL if code != 0 else script_common.PASS, name)
        for name, (_, code) in results.items()
        if name not in skipped
    ]
    statuses += [(script_common.SKIP, f"{name} ({reason})") for name, reason in skips]

    # Aggregate per-test counts from every target's captured pytest/vitest summary.
    passed = tests_failed = tests_skipped = 0
    for lines, _ in results.values():
        tp, tf, ts = diagnostics.count_test_summary(lines)
        passed += tp
        tests_failed += tf
        tests_skipped += ts
    total = passed + tests_failed + tests_skipped

    return script_common.emit_report(
        noun="TESTS",
        artifact_path=artifact,
        statuses=statuses,
        artifact_text=text,
        failed=any_failed,
        counts=(passed, tests_failed, tests_skipped) if total else None,
        unit="tests",
    )


if __name__ == "__main__":
    sys.exit(main())
