#!/usr/bin/env python3
"""Autogenerate an Alembic revision from the current model diff.

The contract entrypoint behind the shared "DB: New Migration (Autogenerate)" workspace
task (`devkit_project.ACTIONS["db-revision"]`). The implementation is deliberately
per-project — ibkr_trader's runs alembic on the host through uv — and what is shared is
the CLI: `-m "<message>"`.

**Alembic runs INSIDE the app container here, and that is not incidental.** This stack
puts PgBouncer in front of Postgres, so the app's own `DATABASE_URL` points at
`pgbouncer:5432` and alembic has to use `DIRECT_DATABASE_URL` to bypass the transaction
pooler for DDL. The container's environment is the single source of that value
(docker-compose.yml), which is the same reason `lint-all.py`'s `_alembic_check_fresh_db`
reads it with `printenv` rather than repeating credentials in a script. Running on the
host would mean duplicating the bypass URL here and hoping it stays in step.

Autogenerate is a DIFF, not a design: it compares `app/models/` against the database the
URL points at. It misses renames (it sees a drop plus an add) and it does not always get
constraint or type changes right. **Read the generated file before committing it** — the
task's `detail` says so too, and this script prints the path it wrote.

Writes a file into `alembic/versions/` and nothing else; it never runs `upgrade`, so the
database is untouched. Failures go to `logs/docker/db-revision.log`.

Usage: python scripts/db-revision.py -m "add call_events index"
"""

from __future__ import annotations

import argparse
import re
import sys

import docker_common as dc

ARTIFACT = "db-revision.log"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-m",
        "--message",
        required=True,
        help="short description of the schema change; becomes part of the filename",
    )
    return parser.parse_args(argv)


def app_running(status_lines) -> bool:
    """True if any app-container status line shows it Up/running.

    Same probe as `docker-migrate.py`, and it uses `docker ps --filter` for the same
    reason: `docker compose ps` can hang on Compose v2 when a container is unhealthy.
    """
    return any("Up" in s or "running" in s for s in status_lines)


def created_paths(output: list[str]) -> list[str]:
    """The revision files alembic reported writing. Pure — unit-tested.

    Alembic prints `Generating /app/alembic/versions/<rev>_<slug>.py ... done`, and that
    path is CONTAINER-side. It is rewritten to the repo-relative form because the whole
    point of printing it is that someone opens it in the editor, where /app does not
    exist.
    """
    paths = []
    for line in output:
        match = re.search(r"Generating\s+(\S+\.py)", line)
        if match:
            container_path = match.group(1).replace("\\", "/")
            _, _, tail = container_path.partition("/alembic/versions/")
            paths.append(f"alembic/versions/{tail}" if tail else container_path)
    return paths


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    print("\n=== Carameli: New Migration (Autogenerate) ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(f"Message  : {args.message}\n")

    status, _, _ = dc.docker_ps(
        "{{.Status}}", all_containers=False, extra_filters=[dc.service_filter("app")]
    )
    if not app_running(status):
        msg = (
            f"service 'app' is not running (status: {' '.join(status) or 'none'}). "
            "Run the 'Docker: Start Stack' task for this checkout first."
        )
        print(f"  [FAIL] {msg}")
        ps_table, _, _ = dc.docker_ps("table {{.Names}}\t{{.Status}}")
        dc.write_artifact(
            ARTIFACT,
            dc.format_artifact(
                "Failed command: python scripts/db-revision.py",
                [msg, "", "=== docker ps (project containers) ===", *ps_table],
            ),
        )
        print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
        return 1

    # DIRECT_DATABASE_URL bypasses PgBouncer; autogenerate opens a real connection to
    # reflect the live schema, and a transaction pooler is the wrong thing behind that.
    output, code = dc.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "app",
            "sh",
            "-c",
            'DATABASE_URL="$DIRECT_DATABASE_URL" '
            f"alembic revision --autogenerate -m {shell_quote(args.message)}",
        ]
    )
    for line in output:
        print(f"  {line}")

    if code != 0:
        print(f"  [FAIL] alembic exited with code {code}")
        dc.write_artifact(
            ARTIFACT,
            dc.format_artifact(
                "Failed command: python scripts/db-revision.py",
                ["=== alembic revision --autogenerate ===", *output],
            ),
        )
        print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
        print(dc.banner("REVISION FAILED"))
        return code

    dc.clear_artifact(ARTIFACT)
    written = created_paths(output)
    print(dc.banner("REVISION WRITTEN"))
    for path in written:
        print(f"  {path}")
    print("\nREAD IT before committing: autogenerate misses renames and gets some")
    print("constraint/type changes wrong. It has NOT been applied to the database.")
    return 0


def shell_quote(value: str) -> str:
    """POSIX-quote a value for the `sh -c` string above. Pure — unit-tested.

    The message is free text from a VS Code prompt, so it reaches a shell inside the
    container. Single-quoting with the `'\\''` escape is what keeps a quote or a `;` in
    the message from being interpreted there.
    """
    return "'" + value.replace("'", "'\\''") + "'"


if __name__ == "__main__":
    sys.exit(main())
