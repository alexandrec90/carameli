#!/usr/bin/env python3
"""UserPromptSubmit hook: start each new task on a fresh branch off origin/master.

Vibe-coding many small changes in parallel means every task should get its own
short-lived branch cut from the latest master -- otherwise work piles onto
whatever branch happened to be checked out and the branches drift. This hook
handles the "start" half automatically for the PRIMARY checkout: when a prompt
arrives while sitting on `master`, it cuts a new `claude/<slug>` branch.

It only acts on the default branch. On any other branch (mid-task on a
`claude/...` branch) it is a fast no-op -- it must never cut a branch mid-task.
Worktrees are never on `master`, so there the explicit `/task` command
(`scripts/start-task.py`) is the entry point instead; this hook no-ops.

Best-effort and always exit 0: a failure here can never block the prompt. The
decision/formatting helpers live in `scripts/task_branch.py` (shared with
`/task`) and are unit-tested in `scripts/hooks/tests/test_task_branch.py`.
"""

import contextlib
import json
import subprocess
import sys
from pathlib import Path

# scripts/ on path so the shared, stdlib-only helper imports before the venv.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import task_branch as tb


def _git(*args: str, timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, timeout=timeout, check=False
    )


def _current_branch() -> str:
    try:
        result = _git("branch", "--show-current")
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def _tree_dirty() -> bool:
    try:
        result = _git("status", "--porcelain")
    except (OSError, subprocess.TimeoutExpired):
        return True  # unknown -> treat as dirty (the safe, non-clobbering choice)
    return bool(result.stdout.strip())


def _existing_branches() -> set[str]:
    try:
        result = _git("branch", "--list", "--format=%(refname:short)")
    except (OSError, subprocess.TimeoutExpired):
        return set()
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _emit_context(text: str) -> None:
    """Feed a note back into the session as UserPromptSubmit additionalContext."""
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": text,
                }
            }
        )
    )


def main() -> int:
    raw = ""
    try:
        if sys.stdin is not None and not sys.stdin.isatty():
            raw = sys.stdin.read()
    except (OSError, ValueError):
        raw = ""

    if not tb.should_branch(_current_branch()):
        return 0  # mid-task on a feature branch, or detached, or a worktree -- no-op.

    # Starting new work on master: refresh origin so the cut is from latest.
    # Offline is fine -- fall back to whatever origin/master we already have.
    with contextlib.suppress(OSError, subprocess.TimeoutExpired):
        _git("fetch", "--prune", "origin", tb.DEFAULT_BRANCH, timeout=60.0)

    dirty = _tree_dirty()
    name = tb.branch_name(tb.slugify(tb.parse_prompt(raw)), _existing_branches())
    base = tb.checkout_base(dirty)

    argv = ["checkout", "-b", name] + ([base] if base else [])
    try:
        result = _git(*argv)
    except (OSError, subprocess.TimeoutExpired):
        return 0
    if result.returncode != 0:
        return 0  # never block the prompt on a git failure.

    if base:
        _emit_context(f"Started task on fresh branch '{name}' (cut from {base}).")
    else:
        _emit_context(
            f"Started task on fresh branch '{name}' carrying your uncommitted "
            f"changes (tree was dirty, so it was not reset onto origin/{tb.DEFAULT_BRANCH})."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
