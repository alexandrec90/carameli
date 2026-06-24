#!/usr/bin/env python3
"""Moves checked items (`* [X]` / `* [x]`) from active sections into `## Done`.

Operates on `todo.md` at the repo root. The pure `archive_todos` function is
unit-tested in `scripts/hooks/tests/test_archive_done_todos.py`.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TODO_FILE = REPO_ROOT / "todo.md"
DONE_MARKER = "## Done"
_CHECKED_RE = re.compile(r"^\* \[[Xx]\]")


def archive_todos(text: str) -> tuple[str, int]:
    """Return (new_text, moved_count). Raises ValueError if no `## Done` section."""
    lines = text.splitlines()
    if DONE_MARKER not in lines:
        raise ValueError(f"No '{DONE_MARKER}' section found in todo.md")

    active: list[str] = []
    done: list[str] = []
    moved = 0
    in_done = False
    for line in lines:
        if line == DONE_MARKER:
            in_done = True
            continue
        if in_done:
            done.append(line)
        elif _CHECKED_RE.match(line):
            done.append(line)
            moved += 1
        else:
            active.append(line)

    # Trim trailing blank lines before the Done section.
    while active and active[-1].strip() == "":
        active.pop()

    # Normalize Done: drop blank lines, then re-add exactly one after the heading.
    normalized_done = [line for line in done if line.strip() != ""]

    output = [*active, "", DONE_MARKER, "", *normalized_done]
    return "\n".join(output) + "\n", moved


def main() -> int:
    if not TODO_FILE.exists():
        print(f"todo.md not found at {TODO_FILE}", file=sys.stderr)
        return 1
    try:
        new_text, moved = archive_todos(TODO_FILE.read_text(encoding="utf-8"))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    TODO_FILE.write_text(new_text, encoding="utf-8", newline="")
    print(f"Moved {moved} checked item(s) to '{DONE_MARKER}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
