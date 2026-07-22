#!/usr/bin/env python3
"""Rebase the current clean branch onto origin/master, keeping signatures.

The local-only auto-sync helper invoked by .claude/hooks/session-start.sh (only
in local sessions — never cloud/remote, where the platform manages the branch).
It replaces the repo-local `git-sync.py` VS Code task that was removed from
master in favour of a global User task: the session-start auto-rebase feature
still needs rebase logic, so it lives here as a tested hook helper rather than
resurrecting that task.

Key difference from a plain rebase: it passes `--gpg-sign` when `commit.gpgsign`
is configured, because `git rebase` otherwise drops commit signatures — which is
what made replayed commits show as Unverified on GitHub.

stdlib-only (hooks run before the venv). The pure helpers (`gpgsign_flag`,
`rebase_argv`) are unit-tested in scripts/hooks/tests/test_session_sync.py.
"""

from __future__ import annotations

import subprocess
import sys

UPSTREAM = "origin/master"
UPSTREAM_REF = "refs/remotes/origin/master"


def gpgsign_flag(commit_gpgsign: str) -> list[str]:
    """['--gpg-sign'] when commit.gpgsign is truthy, else [] — so replayed
    commits keep their signature wherever signing is configured, and it stays a
    no-op where it isn't."""
    return ["--gpg-sign"] if commit_gpgsign.strip().lower() == "true" else []


def rebase_argv(commit_gpgsign: str, upstream: str = UPSTREAM) -> list[str]:
    """git args for the sync rebase: no autostash, signed when configured."""
    return ["rebase", "--no-autostash", *gpgsign_flag(commit_gpgsign), upstream]


def run_git(*args: str, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=capture_output, check=False, text=True)


def _report(result: subprocess.CompletedProcess[str]) -> int:
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    return result.returncode


def main() -> int:
    status = run_git("status", "--porcelain", capture_output=True)
    if status.returncode != 0:
        return _report(status)
    if status.stdout.strip():
        print(
            "Working tree is not clean. Commit your changes before syncing; "
            "this never stashes them.",
            file=sys.stderr,
        )
        return 1

    branch = run_git("branch", "--show-current", capture_output=True)
    if branch.returncode != 0:
        return _report(branch)
    if not branch.stdout.strip():
        print("Cannot sync while HEAD is detached. Check out a branch first.", file=sys.stderr)
        return 1

    print(f"Syncing '{branch.stdout.strip()}' with {UPSTREAM}...", flush=True)
    fetch = run_git("fetch", "--prune", "origin")
    if fetch.returncode != 0:
        return fetch.returncode

    verify = run_git("rev-parse", "--verify", "--quiet", UPSTREAM_REF, capture_output=True)
    if verify.returncode != 0:
        print(f"{UPSTREAM} was not found after fetching.", file=sys.stderr)
        return 1

    gpgsign = run_git("config", "--get", "commit.gpgsign", capture_output=True)
    commit_gpgsign = gpgsign.stdout if gpgsign.returncode == 0 else ""
    return run_git(*rebase_argv(commit_gpgsign)).returncode


if __name__ == "__main__":
    sys.exit(main())
