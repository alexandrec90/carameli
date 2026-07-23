#!/usr/bin/env python3
"""Preflight + push mechanics for the /ship workflow.

The /ship skill drives the semantic steps (commit message, PR body, subscribing
to PR activity via the GitHub MCP tools). This script owns the mechanical,
testable half so those steps run against a branch that is actually shippable:

  --preflight    : assert we are on a feature branch (not master, not detached).
                   Cheap, no lint, no network -- run it FIRST to fail fast.
  (default)      : assert feature branch + clean tree, run the changed-scope lint
                   pre-flight (the same gate CI runs), then push -u origin with
                   network-error backoff. Prints the branch + base for the PR.
                   Does NOT drop the shipped marker -- see --mark-shipped.
  --mark-shipped : record the branch in the per-worktree shipped marker so the
                   next prompt auto-starts a fresh task branch. The /ship skill
                   runs this ONLY after the PR is open, so a session that dies
                   between push and PR never orphans a pushed branch behind a
                   marker (the next prompt would be a mid-task no-op, and
                   re-running /ship resumes: the push no-ops, then the PR opens).

The default and --mark-shipped modes are deliberately separate because dropping
the marker at push time (before the PR exists) is exactly what orphans a pushed
branch when PR creation fails or the session ends: the marker then steers the
next prompt onto a brand-new branch, silently abandoning un-PR'd work.

The decision helpers (`is_shippable`, `tree_clean`, `backoff_delays`,
`parse_lint_ok`) are pure and unit-tested in
`scripts/hooks/tests/test_ship.py`.
"""

from __future__ import annotations

import contextlib
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
import task_branch as tb

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


def write_shipped_marker(branch: str) -> None:
    """Record `branch` as shipped in the per-worktree marker, so the next prompt
    auto-starts a fresh task branch (see scripts/hooks/branch-per-task.py).
    Best-effort: a marker failure must never fail a successful ship."""
    result = _git("rev-parse", "--git-path", tb.SHIPPED_MARKER_NAME)
    if result.returncode != 0 or not result.stdout.strip():
        return
    path = REPO_ROOT / result.stdout.strip()
    with contextlib.suppress(OSError):
        path.write_text(branch + "\n", encoding="utf-8")


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
    mark_shipped = "--mark-shipped" in argv

    branch = current_branch()
    ok, reason = is_shippable(branch)
    if not ok:
        print(f"ship: {reason}", file=sys.stderr)
        return EXIT_NOT_SHIPPABLE

    if preflight_only:
        print(f"ship: '{branch}' is shippable.")
        return EXIT_OK

    if mark_shipped:
        # Runs only after the PR is open (see the /ship skill). Arming the marker
        # here -- not at push time -- is what keeps a push-but-no-PR branch from
        # being orphaned by the next prompt's auto-branch.
        write_shipped_marker(branch)
        print(f"ship: marked '{branch}' shipped; the next prompt starts a fresh task branch.")
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

    # NB: the shipped marker is intentionally NOT dropped here. It is armed by a
    # separate `--mark-shipped` run only after the PR is open, so a session that
    # dies between this push and PR creation cannot orphan a pushed branch.
    print(
        f"ship: pushed '{branch}'. Open a PR against '{DEFAULT_BRANCH}', then run "
        f"'python scripts/ship.py --mark-shipped' to arm the next task branch."
    )
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
