#!/usr/bin/env python3
"""Runs the test suite and writes only the failures to `logs/test-failures.log`
for AI-agent consumption. On pass, clears the artifact.

One entrypoint for every environment:
  - **Local desktop:** `python scripts/run-tests.py` runs the full suite inside
    the app container (xdist). `--fast` runs the changed-only set via testmon,
    falling back to a full xdist run (with --testmon-noselect) when testmon
    selects more than half the suite. `--all` runs every target (pytest, hook,
    frontend, telnyx) in one process and merges them into a single artifact, so
    the aggregate VS Code task no longer fans out into racing writers.
  - **CI (GitHub Actions):** `python scripts/run-tests.py` with `CI=true` runs
    pytest + hook tests + frontend tests directly on the runner (no Docker stack).
    Backend failures go to `logs/test-failures.log`; frontend (vitest) failures
    are split into `logs/frontend-test-failures.log` so the mobile fix-all path can
    skip what a cloud session can't verify instead of spiralling on it.

Filtering / artifact format live in `scripts/diagnostics.py` (shared with
`scripts/lint-all.py`), so local and CI never drift.
"""

import math
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import diagnostics
import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]
IS_CI = bool(os.environ.get("CI"))

_ADDOPTS = "--ignore=tests/e2e --ignore=tests/load --ignore=tests/quarantine"
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
    "-v",
    "--tb=short",
    "--no-header",
    "--color=no",
]
_VALID_TARGETS = {"pytest", "hook-tests", "frontend-tests", "telnyx-sandbox"}
# Order is cosmetic only (results are merged into one dict); pytest first so its
# "Running pytest..." banner leads the interleaved output.
_ALL_TARGETS = ("pytest", "hook-tests", "frontend-tests", "telnyx-sandbox")
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


def parse_cli_args(argv: list[str]) -> tuple[bool, str | None]:
    """Return (`fast`, `target`) from the CLI args."""
    fast = False
    target: str | None = None

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("--fast", "-Fast"):
            fast = True
        elif arg == "--all":
            target = "all"
        elif arg.startswith("--target="):
            target = arg.split("=", 1)[1]
        elif arg == "--target" and i + 1 < len(argv):
            target = argv[i + 1]
            i += 1
        i += 1

    return fast, target


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


def run_local(fast: bool) -> dict[str, tuple[list[str], int]]:
    pytest_cmd = pick_fast_command() if fast else _PYTEST_FULL
    mode = "fast (changed-only, testmon)" if fast else "full (parallel, xdist)"
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
    if target == "telnyx-sandbox":
        argv = _CI_TELNYX_SANDBOX_ARGV if IS_CI else _LOCAL_TELNYX_SANDBOX_ARGV
        env = {"TELNYX_SANDBOX": "1"} if IS_CI else None
        return {"telnyx-sandbox": run_argv(argv, extra_env=env)}
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


def run_ci() -> dict[str, tuple[list[str], int]]:
    print("\nRunning pytest + hook tests + frontend tests (CI)...")
    return {
        "pytest": run_argv(_CI_PYTEST_ARGV),
        "hook-tests": run_argv(_CI_HOOK_ARGV),
        "frontend-tests": run_argv(_CI_FRONTEND_ARGV),
    }


def main() -> int:
    fast, target = parse_cli_args(sys.argv[1:])
    if target and target != "all" and target not in _VALID_TARGETS:
        print(
            "Unknown --target. Expected one of: " + ", ".join(sorted(_VALID_TARGETS)),
            file=sys.stderr,
        )
        return 2
    if target and fast and target != "pytest":
        print(
            "--fast only applies to the default pytest suite or --target pytest.", file=sys.stderr
        )
        return 2

    label = "scripts/run-tests.py (CI)" if IS_CI else "scripts/run-tests.py (local)"

    artifact = REPO_ROOT / "logs" / "test-failures.log"
    target_line = [f"Target   : {target}"] if target else []
    script_common.print_suite_header("Test Suite", artifact, target_line)

    if target == "all":
        results = run_all()
    elif target:
        results = run_named_target(target)
    else:
        results = run_ci() if IS_CI else run_local(fast)

    if IS_CI:
        # Split frontend (vitest) failures into their own artifact. A cloud/mobile
        # session can't run vitest to verify a fix, so the mobile fix-all path must
        # skip them rather than spiral; they need a local session. Backend failures
        # stay in test-failures.log -- verifiable on mobile by pushing for a CI rerun.
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
            print("  (local session only -- the mobile fix-all path skips these)")
    else:
        any_failed, text, skips = diagnostics.digest_tests(results, label)

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
