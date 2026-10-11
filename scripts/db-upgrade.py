#!/usr/bin/env python3
"""Bring the dev database to the migrations' head, or say whether it is there.

The contract devkit's fix pass calls (`fix_migrate.py` there) every half hour, so the
database `db-revision.py` diffs against is never left behind the merged migrations.
ibkr_trader's runs Alembic on the host; this one runs it inside the app container, past
PgBouncer (`docker_common.alembic_in_app`). What is shared is the CLI:

  python scripts/db-upgrade.py --check   # 0 at head, 1 behind, 2 app not up; writes nothing
  python scripts/db-upgrade.py           # apply every pending revision; 0 applied

Any other exit is a failure the pass files. Which branch the checkout is on is the
pass's question, not this script's: run by hand from a task branch, it applies that
branch's migrations, as `docker-migrate.py` does. Failures go to
`logs/docker/db-upgrade.log`; a clean run clears it.
"""

from __future__ import annotations

import argparse
import re
import sys

import docker_common as dc

ARTIFACT = "db-upgrade.log"
CURRENT, BEHIND, UNKNOWN, FAILED = 0, 1, 2, 3

# `014 (head)`, `014 (head) (mergepoint)`: a revision id and its tags, alone on the line.
# Alembic's log lines (`INFO  [alembic.runtime.migration] ...`) share the merged stream
# and carry text outside parentheses, so they never match.
_REVISION = re.compile(r"^(\w+)(?:\s+\([^)]*\))*\s*$")


def revisions(lines: list[str]) -> set[str]:
    """The revision ids `alembic current` or `alembic heads` printed. Pure."""
    return {match.group(1) for line in lines if (match := _REVISION.match(line.strip()))}


def verdict(current: set[str], heads: set[str]) -> int:
    """CURRENT when the database sits on every head, BEHIND otherwise. Pure.

    An empty database has no current revision and is behind; one stamped with a revision
    the tree does not have never gets here -- `alembic current` fails on it."""
    return CURRENT if current == heads else BEHIND


def app_running(status_lines: list[str]) -> bool:
    """True if any app-container status line shows it Up/running (`docker-migrate.py`'s
    probe, through `docker ps --filter` for its reason)."""
    return any("Up" in s or "running" in s for s in status_lines)


def fail(what: str, output: list[str]) -> int:
    dc.write_artifact(
        ARTIFACT,
        dc.format_artifact("Failed command: python scripts/db-upgrade.py", [what, "", *output]),
    )
    print(f"error: {what} -- details in {dc.DOCKER_LOG_DIR / ARTIFACT}", file=sys.stderr)
    return FAILED


def check() -> int:
    current, code = dc.run(dc.alembic_in_app("current"))
    if code != 0:
        return fail(f"alembic current exited {code}", current)
    heads, code = dc.run(dc.alembic_in_app("heads"))
    if code != 0:
        return fail(f"alembic heads exited {code}", heads)
    dc.clear_artifact(ARTIFACT)
    found = verdict(revisions(current), revisions(heads))
    print("at head" if found == CURRENT else "behind head")
    return found


def upgrade() -> int:
    output, code = dc.run(dc.alembic_in_app("upgrade", "head"))
    for line in output:
        print(f"  {line}")
    if code != 0:
        return fail(f"alembic upgrade head exited {code}", output)
    dc.clear_artifact(ARTIFACT)
    print("upgraded to head")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report, apply nothing")
    args = parser.parse_args(argv)
    status, _, _ = dc.docker_ps(
        "{{.Status}}", all_containers=False, extra_filters=[dc.service_filter("app")]
    )
    if not app_running(status):
        print("service 'app' is not running; nothing to check or apply")
        return UNKNOWN
    return check() if args.check else upgrade()


if __name__ == "__main__":
    sys.exit(main())
