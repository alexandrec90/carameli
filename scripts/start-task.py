#!/usr/bin/env python3
"""Start a task on a fresh `claude/<slug>` branch cut from latest origin/master.

The explicit entry point behind the `/task` command -- the start-of-task partner
to `/ship`. Written for the worktree workflow: you are never on `master` (it is
checked out in the primary worktree) and always sit on a stale, already-shipped
branch, so the auto-hook cannot fire. Creating a NEW branch off `origin/master`
is allowed in a worktree even while `master` is checked out elsewhere -- the
one-checkout-per-branch rule only applies to checking out the same branch twice.

Refuses a dirty tree: uncommitted changes mean unfinished work on the current
branch, and starting a new task would either strand or carry them. Commit and
`/ship` first (or stash). `blocked_reason` is pure and unit-tested in
`scripts/hooks/tests/test_start_task.py`.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
import task_branch as tb

REPO_ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_REF = f"refs/remotes/origin/{tb.DEFAULT_BRANCH}"

EXIT_OK = 0
EXIT_DIRTY_TREE = 4  # uncommitted changes -- commit/ship or stash first
EXIT_NO_UPSTREAM = 7  # origin/master not found after fetch
EXIT_CHECKOUT_FAILED = 8  # git checkout -b failed


def blocked_reason(tree_dirty: bool) -> str:
    """Reason to refuse starting a task, or '' when clear to start."""
    if tree_dirty:
        return (
            "Working tree has uncommitted changes. Finish the current task first "
            "(/ship), or stash, before starting a new one -- /task will not strand "
            "or silently carry your changes."
        )
    return ""


def _git(*args: str, timeout: float = 60.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, timeout=timeout, check=False
    )


def _tree_dirty() -> bool:
    result = _git("status", "--porcelain")
    return bool(result.stdout.strip()) if result.returncode == 0 else True


def _existing_branches() -> set[str]:
    result = _git("branch", "--list", "--format=%(refname:short)")
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    description = " ".join(argv).strip()

    reason = blocked_reason(_tree_dirty())
    if reason:
        print(f"task: {reason}", file=sys.stderr)
        return EXIT_DIRTY_TREE

    _git("fetch", "--prune", "origin", tb.DEFAULT_BRANCH)
    if _git("rev-parse", "--verify", "--quiet", UPSTREAM_REF).returncode != 0:
        print(
            f"task: origin/{tb.DEFAULT_BRANCH} not found after fetch -- cannot start "
            "a fresh branch from it.",
            file=sys.stderr,
        )
        return EXIT_NO_UPSTREAM

    name = tb.branch_name(tb.slugify(description), _existing_branches())
    base = f"origin/{tb.DEFAULT_BRANCH}"
    result = _git("checkout", "-b", name, base)
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip(), file=sys.stderr)
        return EXIT_CHECKOUT_FAILED

    print(f"task: started '{name}' from {base}. Work here, then /ship when done.")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
