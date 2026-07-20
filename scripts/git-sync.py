#!/usr/bin/env python3
"""Rebase the current clean worktree branch onto origin/master."""

from __future__ import annotations

import subprocess
import sys

UPSTREAM = "origin/master"
UPSTREAM_REF = "refs/remotes/origin/master"


def run_git(*args: str, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    """Run Git in the current worktree without invoking a shell."""
    return subprocess.run(
        ["git", *args],
        capture_output=capture_output,
        check=False,
        text=True,
    )


def _report_command_error(result: subprocess.CompletedProcess[str]) -> int:
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    return result.returncode


def main() -> int:
    status = run_git("status", "--porcelain", capture_output=True)
    if status.returncode != 0:
        return _report_command_error(status)
    if status.stdout.strip():
        print(
            "Working tree is not clean. Commit your changes before syncing; "
            "this task will never stash them.",
            file=sys.stderr,
        )
        return 1

    branch_result = run_git("branch", "--show-current", capture_output=True)
    if branch_result.returncode != 0:
        return _report_command_error(branch_result)
    branch = branch_result.stdout.strip()
    if not branch:
        print("Cannot sync while HEAD is detached. Check out a branch first.", file=sys.stderr)
        return 1

    print(f"Syncing '{branch}' with {UPSTREAM}...", flush=True)
    fetch = run_git("fetch", "--prune", "origin")
    if fetch.returncode != 0:
        return fetch.returncode

    verify = run_git("rev-parse", "--verify", "--quiet", UPSTREAM_REF, capture_output=True)
    if verify.returncode != 0:
        print(f"{UPSTREAM} was not found after fetching.", file=sys.stderr)
        return 1

    # Be explicit even if the user's Git config enables rebase.autoStash.
    return run_git("rebase", "--no-autostash", UPSTREAM).returncode


if __name__ == "__main__":
    sys.exit(main())
