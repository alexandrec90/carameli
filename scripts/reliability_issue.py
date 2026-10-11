"""Pick the GitHub issue the Weekly Hardening summary is posted to.

The weekly workflow's ``Post summary to the pinned reliability issue`` step pipes
``gh issue list --state all --json number,title,state,isPinned`` into this script,
which prints ``<number> <OPEN|CLOSED>`` for the issue to comment on, or fails.

Why a closed issue is still a match
-----------------------------------
The step used to search **open** issues only, so closing the standing thread --
one click, made on 2026-10-04 while triaging the issue list -- turned the next
Sunday's run red with "no issue found", although the thread, its pin and its
history were all still there. A closed thread is not a missing delivery path: the
workflow reopens it (with a comment saying why) and posts as before, and the
reopen is itself the visible notice that the close was undone.

Only an issue that does not exist at all, in any state, still fails the job. That
half of the fail-loud contract is unchanged: the workflow never *creates* the
issue, because a red run is the alert here, not an auto-filed issue.

Matching is on the exact title. ``gh``'s ``in:title`` search is a word match, so
an unrelated issue that merely mentions the words would otherwise be picked.

Stdlib only, so the hook-tests gate can exercise it before the venv exists.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

ISSUE_TITLE = "Weekly Test Reliability Report"


def choose_issue(issues: list[dict[str, Any]], title: str = ISSUE_TITLE) -> tuple[int, str] | None:
    """Return ``(number, state)`` of the issue to post to, or ``None`` when none exists.

    Preference: open over closed, then pinned over unpinned, then the oldest
    (lowest number), so the summary keeps landing in the same standing thread.
    """
    matches = [issue for issue in issues if str(issue.get("title", "")).strip() == title]
    if not matches:
        return None
    best = min(
        matches,
        key=lambda issue: (
            str(issue.get("state", "")).upper() != "OPEN",
            not issue.get("isPinned", False),
            int(issue["number"]),
        ),
    )
    state = "OPEN" if str(best.get("state", "")).upper() == "OPEN" else "CLOSED"
    return int(best["number"]), state


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Read `gh issue list --json number,title,state,isPinned` output on stdin and "
            "print '<number> <OPEN|CLOSED>' for the weekly reliability issue."
        )
    )
    parser.add_argument("--title", default=ISSUE_TITLE, help="exact issue title to match")
    return parser


def main(argv: list[str] | None = None, stdin_text: str | None = None) -> int:
    args = build_parser().parse_args(argv)
    raw = sys.stdin.read() if stdin_text is None else stdin_text
    try:
        issues = json.loads(raw or "[]")
    except json.JSONDecodeError as exc:
        print(f"::error::Could not parse the issue list from gh: {exc}", file=sys.stderr)
        return 1
    if not isinstance(issues, list):
        print("::error::Expected a JSON list of issues from gh.", file=sys.stderr)
        return 1
    choice = choose_issue(issues, args.title)
    if choice is None:
        print(
            f"::error::No issue titled '{args.title}' exists, open or closed. Create and pin "
            "one; it is the only delivery path for this summary.",
            file=sys.stderr,
        )
        return 1
    number, state = choice
    print(f"{number} {state}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
