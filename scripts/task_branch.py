"""Shared helpers for starting a task on a fresh `claude/<slug>` branch.

Used by two callers that start work the same way but trigger differently:
  - `scripts/hooks/branch-per-task.py` -- the UserPromptSubmit hook, automatic,
    fires only when sitting on `master` (the primary-checkout case).
  - `scripts/start-task.py` -- the explicit `/task` command, for worktrees where
    you are never on `master` and always sit on a stale (shipped/merged) branch.

Pure and stdlib-only so the hook can import it before the venv is active. Tested
in `scripts/hooks/tests/test_task_branch.py`.
"""

from __future__ import annotations

import datetime as _dt
import json
import re

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


def slugify(text: str, max_len: int = SLUG_MAX_LEN) -> str:
    """Turn free text into a branch-safe slug (lowercase, hyphenated)."""
    slug = _SLUG_STRIP_RE.sub("-", text.strip().lower()).strip("-")
    if len(slug) > max_len:
        # Trim at a word boundary so the slug stays readable, not mid-token.
        slug = slug[:max_len].rsplit("-", 1)[0] if "-" in slug[:max_len] else slug[:max_len]
        slug = slug.strip("-")
    return slug or "task"


def should_branch(current_branch: str, default_branch: str = DEFAULT_BRANCH) -> bool:
    """True only when sitting on the default branch (the hook's auto-trigger).

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
    """Which ref to base a new branch on when auto-branching from `master`.

    Clean tree -> branch from `origin/master` (start current). Dirty tree ->
    None: branch from the current HEAD carrying the uncommitted changes, because
    resetting onto origin/master could clobber them.
    """
    return None if tree_dirty else f"origin/{DEFAULT_BRANCH}"
