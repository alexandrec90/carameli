#!/usr/bin/env python3
"""PostToolUse hook: auto-fix the just-edited Python file and relay what remains.

Runs after Edit/Write/MultiEdit on a `.py` file. It applies the cheap,
deterministic fixers in place (`ruff format`, then `ruff check --fix`), so
formatting drift never survives to a commit — the CI lint job no longer gates on
it. Any lint finding ruff *cannot* auto-fix (undefined name, real bug pattern) is
printed to stderr with exit code 2, which Claude Code feeds straight back into the
coding agent's turn so it fixes the issue before finishing — no CI round-trip.

Deliberately ruff-only and single-file to stay fast (milliseconds): the slower,
cross-file checks (mypy / vulture / frontend) belong in the Stop backstop and CI,
not on every keystroke. Best-effort throughout: a missing ruff or an unreadable
payload exits 0 so a tooling gap never blocks the agent.

Pure helpers (`parse_hook_input`, `extract_path`, `is_lintable`, `find_ruff`) are
unit-tested in `scripts/hooks/tests/test_lint_fix.py`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ALLOWED_TOOLS = {"Edit", "Write", "MultiEdit", "apply_patch", "create_file"}
REPO_ROOT = (Path(__file__).parent / "../..").resolve()


def parse_hook_input(raw: str) -> dict | None:
    """Parse raw stdin into a dict, or None when absent/malformed."""
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def extract_path(hook_input: dict | None) -> str | None:
    """Return the edited file path for an allowed tool, else None.

    Tolerates both snake_case and camelCase payload keys (tool_name/toolName,
    tool_input/toolInput, file_path/filePath) so the hook is agnostic to the
    harness's casing.
    """
    if not hook_input:
        return None
    tool = hook_input.get("tool_name") or hook_input.get("toolName") or ""
    if tool and tool not in ALLOWED_TOOLS:
        return None
    tool_input = hook_input.get("tool_input") or hook_input.get("toolInput") or {}
    if not isinstance(tool_input, dict):
        return None
    path = tool_input.get("file_path") or tool_input.get("filePath")
    return path if isinstance(path, str) and path else None


def is_lintable(path: str) -> bool:
    """True for Python source files ruff should format and check."""
    return path.endswith((".py", ".pyi"))


def find_ruff(repo_root: Path) -> str | None:
    """Resolve the ruff executable, preferring the project venv over PATH."""
    for sub in ("Scripts", "bin"):
        for name in ("ruff.exe", "ruff"):
            cand = repo_root / ".venv" / sub / name
            if cand.exists():
                return str(cand)
    return shutil.which("ruff")


def _run(ruff: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [ruff, *args],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
        text=True,
    )


def main() -> int:
    hook_input = parse_hook_input(_read_stdin())
    path = extract_path(hook_input)
    if not path or not is_lintable(path):
        return 0

    target = Path(path)
    if not target.is_absolute():
        target = REPO_ROOT / path
    if not target.exists():
        return 0

    ruff = find_ruff(REPO_ROOT)
    if not ruff:
        return 0

    file_arg = str(target)
    # Deterministic auto-fixers first, silently: formatting and import sorting
    # should never reach the agent as "errors" — they just get applied.
    _run(ruff, "format", file_arg)
    _run(ruff, "check", "--fix", file_arg)

    # Whatever remains is a genuine finding ruff can't fix on its own.
    remaining = _run(ruff, "check", file_arg, "--output-format=concise")
    if remaining.returncode == 0:
        return 0

    detail = (remaining.stdout + remaining.stderr).strip()
    print(
        f"ruff found issues in {path} that need a manual fix:\n{detail}",
        file=sys.stderr,
    )
    return 2


def _read_stdin() -> str:
    """Best-effort read of the hook payload; '' when stdin is a tty or unreadable."""
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return ""
        return sys.stdin.read()
    except (OSError, ValueError):
        return ""


if __name__ == "__main__":
    sys.exit(main())
