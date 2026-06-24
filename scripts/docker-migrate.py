#!/usr/bin/env python3
"""Runs Alembic migrations inside the app container.

On failure writes output to logs/docker/migrate.log; on success clears it.
Uses `docker ps --filter` for status (not `docker compose ps`) to avoid
Compose v2 hangs when containers are unhealthy.
"""
import sys

import docker_common as dc

ARTIFACT = "migrate.log"


def app_running(status_lines) -> bool:
    """True if any app-container status line shows it Up/running."""
    return any("Up" in s or "running" in s for s in status_lines)


def main() -> int:
    print("\n=== Carameli DB Migrations ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print("Command  : docker compose exec app alembic upgrade head\n")

    status, _, _ = dc.docker_ps("{{.Status}}", all_containers=False,
                                extra_filters=[dc.service_filter("app")])
    if not app_running(status):
        msg = (f"service 'app' is not running (status: {' '.join(status)}). "
               "Run the 'Start: Full Stack' task first.")
        print(f"  [FAIL] {msg}")
        ps_table, _, _ = dc.docker_ps("table {{.Names}}\t{{.Status}}")
        dc.write_artifact(ARTIFACT, dc.format_artifact(
            "Failed task: DB: Apply Migrations",
            [msg, "", "=== docker ps (project containers) ===", *ps_table],
        ))
        print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
        return 1

    print("Running alembic upgrade head...")
    output, code = dc.run(["docker", "compose", "exec", "-T", "app", "alembic", "upgrade", "head"])
    for line in output:
        print(f"  {line}")

    if code == 0:
        dc.clear_artifact(ARTIFACT)
        print(dc.banner("MIGRATIONS APPLIED"))
        return 0

    print(f"  [FAIL] alembic exited with code {code}")
    dc.write_artifact(ARTIFACT, dc.format_artifact(
        "Failed task: DB: Apply Migrations",
        ["=== alembic upgrade head ===", *output],
    ))
    print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(dc.banner("MIGRATION FAILED"))
    return code


if __name__ == "__main__":
    sys.exit(main())
