#!/usr/bin/env python3
"""Builds and starts the full Docker Compose stack.

On failure writes unhealthy service logs to logs/docker/build.log; on success
clears it. Uses `docker ps --filter` for health polling instead of
`docker compose ps` to avoid Compose v2 hangs when containers are unhealthy.

Flags:
  --build   Force a rebuild (after changing requirements*.txt or the Dockerfile)
"""

import re
import sys

import docker_common as dc

ARTIFACT = "build.log"

PULL_TIMEOUT = 600
BUILD_TIMEOUT = 600
UP_TIMEOUT = 120
HEALTH_TIMEOUT = 90
HEALTH_INTERVAL = 5

# `Exited (0)` is excluded from both failure patterns: one-shot init services
# exit 0 on success (see docker_common.UNHEALTHY_RE).
_BROKEN_RE = re.compile(r"unhealthy|exited(?! \(0\))|dead", re.IGNORECASE)
_STARTING_RE = re.compile(r"starting|Created|created", re.IGNORECASE)
_FAILURE_RE = re.compile(r"unhealthy|exited(?! \(0\))|dead|created", re.IGNORECASE)


def _fail(message: str, body=None) -> int:
    print(f"  {message}")
    dc.write_artifact(
        ARTIFACT,
        dc.format_artifact(
            "Failed task: Start: Full Stack", body if body is not None else [message]
        ),
    )
    print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
    return 1


def _run_step(label: str, argv, timeout: int) -> tuple[list[str], int, bool]:
    print(f"{label}")
    output, code, timed_out = dc.run_with_timeout(argv, timeout=timeout)
    for line in output:
        print(f"  {line}")
    return output, code, timed_out


def main() -> int:
    build = any(a in ("--build", "-Build") for a in sys.argv[1:])
    dc.ensure_docker_log_dir()

    print("\n=== Carameli Docker Stack ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}\n")

    # --- Step 1: Pull pre-built registry images (skip locally-built images) ---
    _, _, timed_out = _run_step(
        f"Pulling registry images (timeout {PULL_TIMEOUT}s -- first run may be slow)...",
        ["docker", "compose", "pull", "--ignore-buildable"],
        PULL_TIMEOUT,
    )
    if timed_out:
        return _fail(
            f"[TIMEOUT] docker compose pull timed out after {PULL_TIMEOUT}s -- "
            "Docker daemon may be stuck or network is very slow."
        )

    # --- Step 2: Build local app image (only with --build) ---
    if build:
        output, code, timed_out = _run_step(
            f"Building app image (timeout {BUILD_TIMEOUT}s)...",
            ["docker", "compose", "build"],
            BUILD_TIMEOUT,
        )
        if timed_out:
            return _fail(f"[TIMEOUT] docker compose build timed out after {BUILD_TIMEOUT}s.")
        if code != 0:
            return _fail(f"[FAIL] docker compose build exited with code {code}", output)

    # --- Step 3: Start services ---
    output, code, timed_out = _run_step(
        f"Starting services (timeout {UP_TIMEOUT}s)...",
        ["docker", "compose", "up", "-d"],
        UP_TIMEOUT,
    )
    if timed_out:
        return _fail(f"[TIMEOUT] docker compose up -d timed out after {UP_TIMEOUT}s.")
    if code != 0:
        return _fail(f"[FAIL] docker compose up exited with code {code}", output)

    # --- Wait for health checks ---
    print("Waiting for services to become healthy...")
    project = dc.project_name()

    def healthy() -> bool:
        lines, _, ps_timed_out = dc.docker_ps("{{.Names}}|{{.Status}}")
        if ps_timed_out:
            return False
        entries = dc.parse_status_entries(lines, project)
        broken = dc.sick_services(entries, _BROKEN_RE)
        starting = any(_STARTING_RE.search(s) for _, s in entries)
        if broken:
            print(f"  Unhealthy: {', '.join(broken)}")
            return False
        if starting:
            print("  Still starting...")
            return False
        print("  All services healthy")
        return True

    dc.poll_until(healthy, timeout=HEALTH_TIMEOUT, interval=HEALTH_INTERVAL)

    # --- Final status check ---
    lines, _, ps_timed_out = dc.docker_ps("{{.Names}}|{{.Status}}")
    if ps_timed_out:
        return _fail(
            "[TIMEOUT] docker ps timed out during final check -- Docker daemon may be stuck."
        )
    entries = dc.parse_status_entries(lines, project)
    failures = dc.sick_services(entries, _FAILURE_RE)

    if not failures:
        dc.clear_artifact(ARTIFACT)
        print(dc.banner("STACK RUNNING"))
        return 0

    print(f"\n  [FAIL] Services not running: {', '.join(failures)}")
    body = [f"Failed services: {', '.join(failures)}", "", "=== docker ps (project containers) ==="]
    ps_table, _, _ = dc.docker_ps("table {{.Names}}\t{{.Status}}\t{{.Ports}}")
    body += [*ps_table, ""]
    for svc in failures:
        body.append(f"=== logs: {svc} (last 40 lines) ===")
        body += dc.docker_logs(f"{project}-{svc}-1", tail=40)
        body.append("")
    dc.write_artifact(ARTIFACT, dc.format_artifact("Failed task: Start: Full Stack", body))
    print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(dc.banner("STACK FAILED"))
    return 1


if __name__ == "__main__":
    sys.exit(main())
