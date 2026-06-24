#!/usr/bin/env python3
"""Fixes Docker Desktop when it stalls on startup or "Starting Docker Engine" hangs.

More aggressive than docker-restart-engine.py: kills vmmem, force-terminates WSL
with a timeout, resets cached state, and polls until the engine responds.
On failure writes output to logs/docker/fix.log; on success clears it. Windows-only.
"""
import shutil
import sys
import time

import docker_common as dc
from docker_win import (
    DOCKER_DESKTOP_EXE,
    docker_info_ok,
    expand_state_dirs,
    is_admin,
    kill_process,
    launch_docker_desktop,
    process_running,
    start_service,
    stop_service,
    wsl_shutdown,
)

ARTIFACT = "fix.log"
DOCKER_PROCESSES = ["Docker Desktop", "com.docker.backend", "com.docker.service", "com.docker.proxy"]
POLL_TIMEOUT = 90
POLL_INTERVAL = 5


def main() -> int:
    print("\n=== Docker Desktop Fix (aggressive) ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}\n")

    errors: list[str] = []

    # --- Step 1: Kill ALL Docker processes ---
    print("Step 1: Killing Docker processes...")
    for proc in DOCKER_PROCESSES:
        for line in kill_process(proc):
            print(f"  {line}")
    time.sleep(2)
    print("  Done.")

    # --- Step 2: wsl --shutdown with a timeout, force-kill vmmem on hang ---
    print("Step 2: Shutting down WSL (15s timeout)...")
    ok, output = wsl_shutdown(timeout=15)
    if ok:
        for line in output:
            print(f"  {line}")
        print("  WSL shutdown succeeded.")
    else:
        print("  wsl --shutdown timed out -- force-killing vmmem...")
        for line in kill_process("vmmem"):
            print(f"  {line}")
        time.sleep(3)
        if process_running("vmmem"):
            errors += ["=== vmmem still running after force kill ===", ""]
            print("  [ERROR] vmmem still alive. Reboot may be required.")
        else:
            print("  vmmem killed. WSL VM terminated.")

    admin = is_admin()

    # --- Step 3: Stop the Windows service (best-effort, Admin only) ---
    if admin:
        print("Step 3: Stopping com.docker.service Windows service...")
        stop_service("com.docker.service")
        time.sleep(2)
        print("  Done.")
    else:
        print("Step 3: [SKIP] Not Admin -- cannot stop Windows service")

    # --- Step 4: Reset Docker Desktop cached state ---
    print("Step 4: Clearing Docker Desktop cached state...")
    for directory in expand_state_dirs():
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
            print(f"  Removed: {directory}")
        else:
            print(f"  Not found (skip): {directory}")
    print("  Done.")

    # --- Step 5: Restart Windows service (Admin only) ---
    if admin:
        print("Step 5: Starting com.docker.service...")
        start_service("com.docker.service")
        time.sleep(2)
        print("  Done.")

    # --- Step 6: Relaunch Docker Desktop ---
    print("Step 6: Launching Docker Desktop...")
    if launch_docker_desktop():
        print("  Started.")
    else:
        errors += ["=== Docker Desktop not found ===", f"Expected path: {DOCKER_DESKTOP_EXE}", ""]
        print(f"  [ERROR] Docker Desktop not found at: {DOCKER_DESKTOP_EXE}")

    # --- Step 7: Poll until engine responds ---
    print(f"Step 7: Waiting for Docker engine ({POLL_TIMEOUT}s timeout)...")
    ready = dc.poll_until(docker_info_ok, timeout=POLL_TIMEOUT, interval=POLL_INTERVAL)

    if ready:
        dc.clear_artifact(ARTIFACT)
        print(dc.banner("DOCKER ENGINE READY"))
        return 0

    if not errors:
        errors += [f"=== Engine did not respond within {POLL_TIMEOUT}s ===", ""]
    dc.write_artifact(ARTIFACT, dc.format_artifact("Failed task: Docker: Fix Stalled Desktop", errors))
    print(dc.banner("ENGINE STILL NOT RESPONDING"))
    print("  Last resort: reboot the machine.\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
