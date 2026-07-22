#!/usr/bin/env python3
"""UserPromptSubmit hook: start each new task on a fresh branch off origin/master.

Vibe-coding many small changes in parallel means every task should get its own
short-lived branch cut from the latest master -- otherwise work piles onto
whatever branch happened to be checked out and the branches drift. This hook
handles the "start" half of that workflow (the /ship skill handles the "finish"
half): when a prompt arrives while sitting on `master`, it cuts a new
`claude/<slug>` branch so the work lands somewhere isolated and current.

It only acts when the current branch IS the default branch. On any other branch
(i.e. mid-task on a `claude/...` branch) it is a fast no-op -- it must never cut
a new branch in the middle of an ongoing task. Best-effort and always exit 0:
a failure here can never block the prompt.

The decision/formatting helpers (`parse_prompt`, `slugify`, `should_branch`,
`branch_name`, `checkout_base`) are pure and unit-tested in
`scripts/hooks/tests/test_branch_per_task.py`.
"""

import contextlib
import datetime as _dt
import json
import re
import subprocess
import sys

DEFAULT_BRANCH = "master"
BRANCH_PREFIX = "claude/"
SLUG_MAX_LEN = 40
_SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")


def parse_prompt(raw_stdin: str) -> str:
    """Extract the prompt text from a UserPromptSubmit payload; '' when absent."""
    try:
        payload = json.loads(raw_stdin)
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(payload, dict):
        return ""
    value = payload.get("prompt", "")
    return value if isinstance(value, str) else ""


def slugify(prompt: str, max_len: int = SLUG_MAX_LEN) -> str:
    """Turn free-text prompt into a branch-safe slug (lowercase, hyphenated)."""
    slug = _SLUG_STRIP_RE.sub("-", prompt.strip().lower()).strip("-")
    if len(slug) > max_len:
        # Trim at a word boundary so the slug stays readable, not mid-token.
        slug = slug[:max_len].rsplit("-", 1)[0] if "-" in slug[:max_len] else slug[:max_len]
        slug = slug.strip("-")
    return slug or "task"


def should_branch(current_branch: str, default_branch: str = DEFAULT_BRANCH) -> bool:
    """True only when sitting on the default branch (i.e. starting new work).

    A blank branch means detached HEAD -- never branch from there automatically.
    """
    return bool(current_branch) and current_branch == default_branch


def branch_name(slug: str, existing: set[str], today: _dt.date | None = None) -> str:
    """Unique `claude/<slug>-<mmdd>` name, disambiguated with -N against existing."""
    today = today or _dt.date.today()
    base = f"{BRANCH_PREFIX}{slug}-{today:%m%d}"
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def checkout_base(tree_dirty: bool) -> str | None:
    """Which ref to base the new branch on.

    Clean tree -> branch from `origin/master` (start current). Dirty tree ->
    return None: branch from the current HEAD carrying the uncommitted changes,
    because resetting onto origin/master could clobber them.
    """
    return None if tree_dirty else f"origin/{DEFAULT_BRANCH}"


# --- IO wrappers (thin; the logic above is what tests exercise) -------------


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

    if not should_branch(_current_branch()):
        return 0  # mid-task on a feature branch, or detached -- no-op.

    # Starting new work on master: refresh origin so the cut is from latest.
    # Offline is fine -- fall back to whatever origin/master we already have.
    with contextlib.suppress(OSError, subprocess.TimeoutExpired):
        _git("fetch", "--prune", "origin", DEFAULT_BRANCH, timeout=60.0)

    dirty = _tree_dirty()
    slug = slugify(parse_prompt(raw))
    name = branch_name(slug, _existing_branches())
    base = checkout_base(dirty)

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
            f"changes (tree was dirty, so it was not reset onto origin/{DEFAULT_BRANCH})."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
