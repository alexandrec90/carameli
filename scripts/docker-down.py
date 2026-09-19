#!/usr/bin/env python3
"""Stops the Docker Compose containers and keeps them.

`docker compose stop`, not `down`: a stopped container is one Docker Desktop's start
button (`compose start`) can bring back, and a deleted one is not -- after a `down`
the stack can only ever be started again from the task. Stopped is also the state the
nightly `stop-idle` job leaves and the one `restart: unless-stopped` respects across
reboots. Named volumes survive either way; run `docker compose down` by hand when the
containers themselves should go.

On failure writes output to logs/docker/down.log; on success clears it.
"""

import sys

import docker_common as dc

ARTIFACT = "down.log"
COMMAND = ["docker", "compose", "stop"]


def main() -> int:
    print("\n=== Carameli Docker Stop ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(f"Command  : {' '.join(COMMAND)}\n")

    print("Stopping containers...")
    output, code = dc.run(COMMAND)
    for line in output:
        print(f"  {line}")

    if code == 0:
        dc.clear_artifact(ARTIFACT)
        print(dc.banner("STACK STOPPED"))
        return 0

    print(f"  [FAIL] {' '.join(COMMAND)} exited with code {code}")
    dc.write_artifact(
        ARTIFACT,
        dc.format_artifact(
            "Failed task: Stop: Docker Stack",
            [f"=== {' '.join(COMMAND)} ===", *output],
        ),
    )
    print(f"\nErrors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(dc.banner("STOP FAILED"))
    return code


if __name__ == "__main__":
    sys.exit(main())
