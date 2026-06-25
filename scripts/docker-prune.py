#!/usr/bin/env python3
"""Tears down containers, prunes Docker, and compacts the WSL VHDX.

On failure writes output to logs/docker/prune.log; on success clears it.
The VHDX compaction step is Windows/WSL-specific.
"""

import sys

import docker_common as dc
from docker_win import optimize_vhd, vhdx_path, wsl_shutdown

ARTIFACT = "prune.log"


def main() -> int:
    print("\n=== Docker Prune + Compact ===")
    print(f"Artifact : {dc.DOCKER_LOG_DIR / ARTIFACT}\n")

    errors: list[str] = []

    def step(label, argv):
        nonlocal errors
        print(f"{label}...")
        output, code = dc.run(argv)
        for line in output:
            print(f"  {line}")
        if code != 0:
            errors += [f"=== {' '.join(argv)} (exit {code}) ===", *output, ""]
            print(f"  [WARN] {' '.join(argv)} exited with code {code}")
            return False
        print("  Done.")
        return True

    # --- Step 1: docker compose down ---
    step("Stopping containers", ["docker", "compose", "down"])
    # --- Step 2: docker system prune ---
    step("Pruning unused Docker objects", ["docker", "system", "prune", "-f"])

    # --- Step 3: WSL shutdown ---
    print("Shutting down WSL...")
    ok, output = wsl_shutdown(timeout=30)
    for line in output:
        print(f"  {line}")
    if not ok:
        errors += ["=== wsl --shutdown failed ===", *output, ""]
        print("  [WARN] wsl --shutdown failed")
    else:
        print("  Done.")

    # --- Step 4: Compact VHDX ---
    print("Compacting Docker VHDX...")
    path = vhdx_path()
    if not path.exists():
        print(f"  VHDX not found at: {path} -- skipping.")
    else:
        code, output = optimize_vhd(path)
        for line in output:
            print(f"  {line}")
        if code != 0:
            errors += [f"=== Optimize-VHD (exit {code}) ===", f"Path: {path}", *output, ""]
            print(f"  [WARN] Optimize-VHD exited with code {code}")
        else:
            print("  Done.")

    if not errors:
        dc.clear_artifact(ARTIFACT)
        print(dc.banner("PRUNE COMPLETE"))
        return 0

    dc.write_artifact(
        ARTIFACT, dc.format_artifact("Failed task: Docker: Prune + Compact VHDX", errors)
    )
    print(f"Errors written to: {dc.DOCKER_LOG_DIR / ARTIFACT}")
    print(dc.banner("PRUNE HAD ERRORS"))
    return 1


if __name__ == "__main__":
    sys.exit(main())
