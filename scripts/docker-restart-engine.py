#!/usr/bin/env python3
"""Restarts Docker Desktop when the engine is stuck on "Starting the Docker Engine".

Steps: kill processes -> wsl --shutdown -> restart service -> relaunch -> poll.
Requires elevation (Admin) for the service stop/start; without it, falls back to
process-kill + relaunch only. Windows-only by nature (drives Docker Desktop).
"""
import sys

import docker_common as dc
from docker_win import (
    DOCKER_DESKTOP_EXE,
    docker_info_ok,
    is_admin,
    launch_docker_desktop,
    start_service,
    stop_processes,
    stop_service,
    wsl_shutdown,
)

POLL_TIMEOUT = 90
POLL_INTERVAL = 5
ENGINE_PROCESSES = ["Docker Desktop", "com.docker.backend", "com.docker.service"]


def main() -> int:
    admin = is_admin()
    print("\n=== Docker Engine Restart ===\n")

    print("Stopping Docker Desktop...")
    stop_processes(ENGINE_PROCESSES)

    if admin:
        print("Stopping com.docker.service Windows service...")
        stop_service("com.docker.service")
    else:
        print("  [WARN] Not running as Admin -- skipping service stop (process kill only)")

    print("Shutting down WSL...")
    wsl_shutdown()

    if admin:
        print("Starting com.docker.service Windows service...")
        start_service("com.docker.service")

    if not launch_docker_desktop():
        print(f"  [ERROR] Docker Desktop not found at {DOCKER_DESKTOP_EXE}")
        return 1
    print("Launching Docker Desktop...")

    print(f"\nWaiting for Docker engine (timeout {POLL_TIMEOUT}s)...")
    if dc.poll_until(docker_info_ok, timeout=POLL_TIMEOUT, interval=POLL_INTERVAL):
        print(dc.banner("DOCKER ENGINE READY"))
        return 0

    print(dc.banner("ENGINE STILL NOT RESPONDING"))
    print(f"  Docker did not respond within {POLL_TIMEOUT}s.")
    print("  Try:\n    1. Check Docker Desktop UI for error messages")
    print("    2. Run this task again from an Admin terminal\n    3. Reboot the machine\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
