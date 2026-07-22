#!/usr/bin/env python3
"""Preflight + push mechanics for the /ship workflow.

The /ship skill drives the semantic steps (commit message, PR body, subscribing
to PR activity via the GitHub MCP tools). This script owns the mechanical,
testable half so those steps run against a branch that is actually shippable:

  --preflight : assert we are on a feature branch (not master, not detached).
                Cheap, no lint, no network -- run it FIRST to fail fast.
  (default)   : assert feature branch + clean tree, run the changed-scope lint
                pre-flight (the same gate CI runs), then push -u origin with
                network-error backoff. Prints the branch + base for the PR.

The decision helpers (`is_shippable`, `tree_clean`, `backoff_delays`,
`parse_lint_ok`) are pure and unit-tested in
`scripts/hooks/tests/test_ship.py`.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BRANCH = "master"
LINT_ALL = REPO_ROOT / "scripts" / "lint-all.py"

# Distinct exit codes so the skill (and a human) can tell why ship refused.
EXIT_OK = 0
EXIT_NOT_SHIPPABLE = 3  # on master / detached HEAD
EXIT_DIRTY_TREE = 4  # uncommitted changes -- commit before shipping
EXIT_LINT_FAILED = 5  # changed-scope lint gate failed
EXIT_PUSH_FAILED = 6  # push failed after retries


def is_shippable(branch: str, default: str = DEFAULT_BRANCH) -> tuple[bool, str]:
    """(True, '') when `branch` is a pushable feature branch; else (False, reason)."""
    if not branch:
        return False, "HEAD is detached -- check out a feature branch before shipping."
    if branch == default:
        return False, (
            f"On '{default}'. Shipping opens a PR from a feature branch; make your "
            f"changes on a claude/... branch first (the branch-per-task hook does this "
            f"automatically when you start work on {default})."
        )
    return True, ""


def tree_clean(porcelain: str) -> bool:
    """True when `git status --porcelain` reported no changes."""
    return not porcelain.strip()


def backoff_delays() -> list[int]:
    """Exponential backoff schedule (seconds) for network-error push retries."""
    return [2, 4, 8, 16]


def parse_lint_ok(returncode: int) -> bool:
    """lint-all.py exits 0 only when the changed-scope gate is clean."""
    return returncode == 0


# --- IO wrappers ------------------------------------------------------------


def _git(*args: str, capture: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=capture,
        text=True,
        check=False,
    )


def current_branch() -> str:
    result = _git("branch", "--show-current")
    return result.stdout.strip() if result.returncode == 0 else ""


def _porcelain() -> str:
    result = _git("status", "--porcelain")
    return result.stdout if result.returncode == 0 else ""


def _run_lint() -> bool:
    """Run the changed-scope lint gate. Missing tooling counts as a skip (True)."""
    try:
        result = subprocess.run(
            [sys.executable, str(LINT_ALL), "--changed"],
            cwd=REPO_ROOT,
            check=False,
        )
    except OSError:
        print("ship: lint-all.py not runnable here -- deferring lint to CI.", file=sys.stderr)
        return True
    return parse_lint_ok(result.returncode)


def _push(branch: str, sleep=time.sleep) -> bool:
    """Push -u origin <branch>, retrying network errors on a backoff schedule."""
    delays = backoff_delays()
    for attempt in range(len(delays) + 1):
        result = _git("push", "-u", "origin", branch)
        if result.returncode == 0:
            return True
        stderr = (result.stderr or "").lower()
        transient = any(
            s in stderr for s in ("could not resolve", "timed out", "connection", "network")
        )
        if not transient or attempt == len(delays):
            if result.stderr:
                print(result.stderr.rstrip(), file=sys.stderr)
            return False
        sleep(delays[attempt])
    return False


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    preflight_only = "--preflight" in argv

    branch = current_branch()
    ok, reason = is_shippable(branch)
    if not ok:
        print(f"ship: {reason}", file=sys.stderr)
        return EXIT_NOT_SHIPPABLE

    if preflight_only:
        print(f"ship: '{branch}' is shippable.")
        return EXIT_OK

    if not tree_clean(_porcelain()):
        print(
            "ship: working tree has uncommitted changes. Commit them first "
            "(the /ship skill writes the commit), then push.",
            file=sys.stderr,
        )
        return EXIT_DIRTY_TREE

    if not _run_lint():
        print(
            "ship: changed-scope lint gate failed -- see logs/lint-errors.log. "
            "Fix, commit, and re-run ship.",
            file=sys.stderr,
        )
        return EXIT_LINT_FAILED

    if not _push(branch):
        print("ship: push failed after retries.", file=sys.stderr)
        return EXIT_PUSH_FAILED

    print(f"ship: pushed '{branch}'. Open a PR against '{DEFAULT_BRANCH}'.")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
