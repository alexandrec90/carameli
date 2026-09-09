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

# The daemon lost its network state but kept the containers, so each one still pins
# the *ID* of a network that no longer exists and fails to start against it. Matching
# is on the hex ID deliberately: a *name* that is not found means Compose failed to
# create the network, which is a different fault that recreating containers does not
# fix. Seen twice here after Docker Desktop's backend exited overnight -- the built-in
# `bridge` came back with a new ID, which is the tell that the whole network KV store
# was rebuilt rather than restored.
_STALE_NETWORK_RE = re.compile(r"network [0-9a-f]{12,64} not found", re.IGNORECASE)


def stale_network_failure(output) -> bool:
    """True when `up` failed only because containers pin a network the daemon lost.

    The recovery is `--force-recreate`: it rebuilds the container objects against the
    network Compose has just recreated. Named volumes are not touched by container
    recreation, so `carameli_pgdata` and friends survive it.

    Plain `up -d` is *not* enough on its own and that is the trap -- Compose reads the
    service config as unchanged, reuses the container, and start fails on the same dead
    ID it failed on last time. `docker compose start`, which is what Docker Desktop's
    start button issues, can never work here at all: it does not create networks.
    """
    return any(_STALE_NETWORK_RE.search(line) for line in output)


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


def _start_services() -> int | None:
    """Bring the stack up. Returns None on success, or the exit code to return.

    Retries once with `--force-recreate` when, and only when, the first attempt failed
    on a network the daemon lost -- see `stale_network_failure`. The retry is scoped to
    that one fault deliberately: `--force-recreate` discards every container, so making
    it the generic response to a failing `up` would turn an ordinary error, a port
    already bound say, into a full stack rebuild.
    """
    output, code, timed_out = _run_step(
        f"Starting services (timeout {UP_TIMEOUT}s)...",
        ["docker", "compose", "up", "-d"],
        UP_TIMEOUT,
    )
    if timed_out:
        return _fail(f"[TIMEOUT] docker compose up -d timed out after {UP_TIMEOUT}s.")

    if code != 0 and stale_network_failure(output):
        print(
            "\n  [RECOVER] Containers pin a network the daemon no longer has "
            "(Docker Desktop restarted under them). Recreating them...\n"
        )
        output, code, timed_out = _run_step(
            f"Re-running up with --force-recreate (timeout {UP_TIMEOUT}s)...",
            ["docker", "compose", "up", "-d", "--force-recreate"],
            UP_TIMEOUT,
        )
        if timed_out:
            return _fail(
                f"[TIMEOUT] docker compose up -d --force-recreate timed out after {UP_TIMEOUT}s."
            )

    if code != 0:
        return _fail(f"[FAIL] docker compose up exited with code {code}", output)
    return None


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

    # --- Step 3: Start services (recovering once from a lost network) ---
    failure = _start_services()
    if failure is not None:
        return failure

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
