#!/usr/bin/env python3
"""Restarts Docker Desktop when the engine is stuck on "Starting the Docker Engine".

Steps: kill processes -> wsl --shutdown -> restart service -> relaunch -> poll.
Requires elevation (Admin) for the service stop/start; without it, falls back to
process-kill + relaunch only. Windows-only by nature (drives Docker Desktop).
"""

import sys

import docker_common as dc
from docker_win import restart_engine

POLL_TIMEOUT = 90
POLL_INTERVAL = 5


def main() -> int:
    print("\n=== Docker Engine Restart ===\n")
    if restart_engine(poll_timeout=POLL_TIMEOUT, poll_interval=POLL_INTERVAL):
        print(dc.banner("DOCKER ENGINE READY"))
        return 0

    print(dc.banner("ENGINE STILL NOT RESPONDING"))
    print(f"  Docker did not respond within {POLL_TIMEOUT}s.")
    print("  Try:\n    1. Check Docker Desktop UI for error messages")
    print("    2. Run this task again from an Admin terminal\n    3. Reboot the machine\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
