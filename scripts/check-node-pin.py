#!/usr/bin/env python3
"""Say when the Node pin has gone out of support, or when a newer LTS is safe to take.

The gap this fills, stated as the incident: Node 20 left maintenance in April 2026 and
nothing in this repository noticed. The pin was still 20 in September, and what finally
reported it was cspell refusing to start -- a dependency's floor rising past an
end-of-life runtime, five months late and disguised as a broken linter.

Nothing here could have been a Dependabot rule. Dependabot watches the `node:` tag and
would have offered 21, 23 and 25 with equal confidence; those lines are never LTS and
live about six months, so taking one means doing this again by spring. Telling them
apart needs the release schedule, and suppressing them in config needs a hard-coded list
of odd majors -- another literal to maintain, which is the shape of defect this whole
area has been about.

Two questions, deliberately answered with different exit codes:

  - **Is the pinned line still supported?** An unsupported runtime is a defect, not a
    suggestion, so this exits 1. It is the check that was missing.
  - **Is there a newer LTS the dependency tree can already run on?** A notice, exit 0.
    `node_pin.unsatisfied` is what makes it safe to say: a line is only proposed when
    every non-optional `engines.node` in `frontend/package-lock.json` admits it, so the
    answer is never "upgrade and find out".

Network failures are not findings. An offline laptop or a blocked runner means the
question went unasked, and reporting that as "your Node is fine" or as a failure are
both lies; `--offline-exit` decides which way an unreachable schedule falls, and it
defaults to the quiet one.

stdlib only (`urllib`), because this must run before any virtualenv exists.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import diagnostics
import node_pin
import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "node-pin.log"

# The Node project's own release table: one entry per major, with the dates it enters
# LTS, enters maintenance and goes end-of-life. Authoritative and small -- the other
# candidate, dist/index.json, is every release ever published and answers "is this line
# LTS" only by inference from a `lts` field on individual releases.
SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json"


def fetch_schedule(url: str = SCHEDULE_URL, timeout: int = 30) -> dict:
    """The release table, or `{}` when it could not be fetched."""
    try:
        # Deliberately unsuppressed. The audited-url rule is off globally in ruff.toml,
        # so a suppression here would be a dead directive that RUF100 then flags -- and
        # writing the directive's name in a comment is itself parsed as one. The URL is
        # a fixed https constant, never caller input.
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {}


def _date(value: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(value) if value else None
    except ValueError:
        return None


def lts_lines(schedule: dict, today: dt.date) -> list[int]:
    """Every major that has entered LTS and not yet gone end-of-life, oldest first. Pure.

    "Entered LTS" rather than "is even": the rule that even majors become LTS is a
    convention, and this reads the dates that implement it. A line released in April is
    not LTS until that October, and proposing it in between is proposing a current
    release with six months to live.
    """
    supported = []
    for key, entry in schedule.items():
        if not key.startswith("v"):
            continue
        start_lts, end = _date(entry.get("lts")), _date(entry.get("end"))
        if start_lts and start_lts <= today and (end is None or end > today):
            supported.append(int(key[1:]))
    return sorted(supported)


def is_supported(schedule: dict, major: int, today: dt.date) -> bool:
    """Whether `major` is still within its support window. Pure.

    A line absent from the schedule counts as supported: an unknown line is a stale
    copy of this file's idea of Node, and inventing an end-of-life for it would fail
    the gate over our own ignorance.
    """
    entry = schedule.get(f"v{major}")
    if entry is None:
        return True
    end = _date(entry.get("end"))
    return end is None or end > today


def recommend(schedule: dict, pinned: int, constraints: list, today: dt.date) -> int | None:
    """The newest LTS line above the pin that the whole tree admits, or None. Pure."""
    for major in reversed(lts_lines(schedule, today)):
        if major <= pinned:
            return None
        if not node_pin.unsatisfied(major, constraints):
            return major
    return None


def findings(schedule: dict, pinned: int, constraints: list, today: dt.date) -> tuple[list, int]:
    """`(lines, exit_code)` for a fetched schedule. Pure, and the whole verdict."""
    lines: list[str] = []
    code = 0
    if not is_supported(schedule, pinned, today):
        end = _date((schedule.get(f"v{pinned}") or {}).get("end"))
        lines.append(
            f".nvmrc:1:1: NODE_PIN_EOL: Node {pinned} left support on {end} -- it takes no "
            f"security fixes, and the next dependency bump that floors above it will read "
            f"as a broken tool rather than as this"
        )
        code = 1
    newer = recommend(schedule, pinned, constraints, today)
    if newer is not None:
        blocked = {
            major: sorted(node_pin.unsatisfied(major, constraints))[:3]
            for major in reversed(lts_lines(schedule, today))
            if major > newer
        }
        lines.append(
            f".nvmrc:1:1: NODE_PIN_BEHIND: Node {newer} is LTS and every non-optional "
            f"engines.node in the lock admits it -- move .nvmrc, setup-node-env and the "
            f"compose image together"
            + (f" (held back from {blocked} by their own engines)" if blocked else "")
        )
    return lines, code


FIX_HINT = (
    "move .nvmrc, .github/actions/setup-node-env/action.yml and docker-compose.yml's "
    "node: image together -- tests/unit/test_node_version_pin.py fails until all three "
    "agree and the lock admits the line"
)


def artifact_text(found: list[str]) -> str:
    """The finding artifact, in `diagnostics`' section format so agents parse it as usual."""
    if not found:
        return ""
    return "\n".join(
        [
            diagnostics.source_header("scripts/check-node-pin.py"),
            "",
            "# node-pin",
            f"# fix: {FIX_HINT}",
            *found,
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline-exit",
        type=int,
        default=0,
        help="exit code when the release schedule cannot be fetched (default 0: an "
        "unasked question is not a finding)",
    )
    args = parser.parse_args(argv)

    schedule = fetch_schedule()
    if not schedule:
        print("node-pin: release schedule unreachable -- the pin was not checked")
        return args.offline_exit

    pinned = node_pin.pinned_major(REPO_ROOT)
    found, code = findings(
        schedule, pinned, node_pin.engine_constraints(REPO_ROOT), dt.date.today()
    )
    if not found:
        print(f"node-pin: Node {pinned} is supported, and no newer LTS the lock admits.")
    return script_common.emit_report(
        noun="NODE PIN",
        artifact_path=ARTIFACT,
        statuses=[(script_common.FAIL if code else script_common.SKIP, line) for line in found],
        artifact_text=artifact_text(found),
        failed=bool(code),
    )


if __name__ == "__main__":
    sys.exit(main())
