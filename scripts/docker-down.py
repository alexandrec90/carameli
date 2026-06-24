#!/usr/bin/env python3
"""Stops and removes all Docker Compose containers.

On failure writes output to logs/docker/down.log; on success clears it.
"""
import sys

import docker_common as dc

ARTIFACT = "down.log"


def main() -> int:
    print("\n=== Carameli Docker Stop ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print("Command  : docker compose down\n")

    print("Stopping containers...")
    output, code = dc.run(["docker", "compose", "down"])
    for line in output:
        print(f"  {line}")

    if code == 0:
        dc.clear_artifact(ARTIFACT)
        print(dc.banner("STACK STOPPED"))
        return 0

    print(f"  [FAIL] docker compose down exited with code {code}")
    dc.write_artifact(ARTIFACT, dc.format_artifact(
        "Failed task: Stop: Docker Stack",
        ["=== docker compose down ===", *output],
    ))
    print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(dc.banner("STOP FAILED"))
    return code


if __name__ == "__main__":
    sys.exit(main())
