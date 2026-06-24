#!/usr/bin/env python3
"""Restarts the app container without rebuilding.

On failure writes output to logs/docker/restart.log; on success clears it.
Uses `docker ps --filter` for status to avoid Compose v2 hangs.
"""
import sys

import docker_common as dc

ARTIFACT = "restart.log"


def app_present(status_lines) -> bool:
    """True if the app container exists and is Up/running/Restarting."""
    blob = " ".join(status_lines)
    return any(tok in blob for tok in ("Up", "running", "Restarting"))


def app_healthy(status_lines) -> bool:
    return any("healthy" in s for s in status_lines)


def app_broken(status_lines) -> bool:
    blob = " ".join(status_lines)
    return any(tok in blob for tok in ("unhealthy", "Exited", "exited", "Dead", "dead"))


def _app_status() -> list[str]:
    status, _, _ = dc.docker_ps("{{.Status}}", all_containers=False,
                                extra_filters=[dc.service_filter("app")])
    return status


def main() -> int:
    project = dc.project_name()
    print("\n=== Carameli Restart App ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print("Command  : docker compose restart app\n")

    if not app_present(_app_status()):
        status = _app_status()
        msg = (f"service 'app' is not running (status: {' '.join(status)}). "
               "Run the 'Start: Full Stack' task first.")
        print(f"  [FAIL] {msg}")
        ps_table, _, _ = dc.docker_ps("table {{.Names}}\t{{.Status}}")
        dc.write_artifact(ARTIFACT, dc.format_artifact(
            "Failed task: Restart: App Container",
            [msg, "", "=== docker ps (project containers) ===", *ps_table],
        ))
        print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
        return 1

    print("Restarting app container...")
    output, code = dc.run(["docker", "compose", "restart", "app"])
    for line in output:
        print(f"  {line}")

    if code != 0:
        print(f"  [FAIL] docker compose restart app exited with code {code}")
        dc.write_artifact(ARTIFACT, dc.format_artifact(
            "Failed task: Restart: App Container",
            ["=== docker compose restart app ===", *output],
        ))
        print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
        return code

    print("Waiting for app to become healthy...")
    dc.poll_until(lambda: app_healthy(_app_status()), timeout=30, interval=3)

    status = _app_status()
    if app_broken(status):
        print(f"  [FAIL] app is {' '.join(status)} after restart")
        ps_table, _, _ = dc.docker_ps("table {{.Names}}\t{{.Status}}")
        logs = dc.docker_logs(f"{project}-app-1", tail=40)
        dc.write_artifact(ARTIFACT, dc.format_artifact(
            "Failed task: Restart: App Container",
            [f"App status after restart: {' '.join(status)}", "",
             "=== docker ps (project containers) ===", *ps_table, "",
             "=== logs: app (last 40 lines) ===", *logs],
        ))
        print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
        print(dc.banner("RESTART FAILED"))
        return 1

    dc.clear_artifact(ARTIFACT)
    print(dc.banner("APP RESTARTED"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
