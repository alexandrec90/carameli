#!/usr/bin/env python3
"""Tears down containers, prunes Docker, and compacts the WSL VHDX.

Order matters: prune (daemon up) -> stop Docker Desktop -> wsl --shutdown ->
compact -> relaunch + verify engine -> compose up + wait for health. Stopping
Docker Desktop before the shutdown gives Optimize-VHD exclusive access to the
VHDX; verifying the engine afterward stops the script from reporting success on
a wedged "Starting the Docker Engine"; the final compose up restores the stack
that step 1 tore down, so the task round-trips back to a healthy stack.

On failure writes output to logs/docker/prune.log; on success clears it.
The VHDX compaction step is Windows/WSL-specific.
"""

import argparse
import sys

import docker_common as dc
from docker_win import (
    ENGINE_PROCESSES,
    docker_info_ok,
    is_admin,
    launch_docker_desktop,
    optimize_vhd,
    restart_engine,
    start_service,
    stop_processes,
    stop_service,
    vhdx_path,
    wsl_shutdown,
)

ARTIFACT = "prune.log"

# After compaction the engine must be relaunched and confirmed reachable before
# the script reports success -- otherwise it exits "PRUNE COMPLETE" on a wedged
# engine (which is exactly what happened before this guard existed).
ENGINE_POLL_TIMEOUT = 90
ENGINE_POLL_INTERVAL = 5

# After `compose up -d`, wait for healthchecks to settle. Slowest starters
# (jambonz, freeswitch) take ~30-60s from existing images.
STACK_POLL_TIMEOUT = 120
STACK_POLL_INTERVAL = 5


def stack_settled(entries) -> bool:
    """True when the stack is up and no container is sick or still starting.

    `entries` are (service, status) pairs from docker ps. Containers without a
    healthcheck ("Up 10 seconds") count as settled; "(health: starting)" and
    freshly-Created containers do not, so we don't declare success mid-boot.
    """
    if not entries:
        return False
    if dc.sick_services(entries):
        return False
    return not any(dc.STARTING_RE.search(status) for _, status in entries)


def engine_down_error(recover_hint: str = "scripts/docker-restart-engine.py") -> list[str]:
    """Artifact lines emitted when the engine never comes back -- even after the
    in-script auto-recovery. At that point it's a Docker Desktop-level problem
    that needs a manual look or a reboot."""
    return [
        "=== Docker engine did not come back within "
        f"{ENGINE_POLL_TIMEOUT}s, even after auto-recovery ===",
        f"Retry manually from an Admin terminal: python {recover_hint}",
        "Then check the Docker Desktop UI for errors, or reboot.",
        "",
    ]


def prune_steps(deep: bool) -> list[tuple[str, list[str]]]:
    """Docker cleanup passes, run in order.

    Default (non-deep) prunes only *dangling* images/cache -- reclaiming orphaned
    build layers while KEEPING the stack's tagged base images, so the next `up`
    doesn't re-pull multi-GB images (freeswitch, jambonz, ...). `deep=True` widens
    this to ALL unused images/cache, which nukes those base images too -- more
    space, but a full re-pull next time. Deep is therefore opt-in (`--deep`).

    Deliberately NO `--volumes` in either mode: step 1 runs `docker compose down`,
    which detaches the named volumes (carameli_pgdata, ...); `prune --volumes` would
    then see them as unused and DELETE THEM -- the `down -v` data-loss hazard called
    out in CLAUDE.md. Never add `--volumes` here.
    """
    image_flag = "-af" if deep else "-f"
    scope = "all unused" if deep else "dangling"
    return [
        ("Pruning stopped containers + networks", ["docker", "container", "prune", "-f"]),
        (f"Pruning {scope} images", ["docker", "image", "prune", image_flag]),
        (f"Pruning {scope} build cache", ["docker", "builder", "prune", image_flag]),
    ]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Prune Docker and compact the WSL VHDX.")
    parser.add_argument(
        "--deep",
        action="store_true",
        help="Also remove ALL unused images + build cache (not just dangling). "
        "Reclaims more space but forces a full re-pull of every stack base image "
        "on the next `docker compose up`.",
    )
    args = parser.parse_args(argv)

    mode = "deep" if args.deep else "default (dangling-only)"
    print("\n=== Docker Prune + Compact ===")
    print(f"Mode     : {mode}")
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

    admin = is_admin()

    # --- Step 1: docker compose down (prune below needs the daemon still up) ---
    step("Stopping containers", ["docker", "compose", "down"])
    # --- Step 2: Docker prune (dangling by default; all unused with --deep) ---
    for label, cmd in prune_steps(args.deep):
        step(label, cmd)

    # --- Step 3: cleanly stop Docker Desktop BEFORE shutting down WSL ---
    # Without this, Docker Desktop stays alive and remounts the WSL VHDX the
    # instant `wsl --shutdown` runs -- racing Optimize-VHD (which needs exclusive
    # access) and wedging the engine on "Starting the Docker Engine...".
    print("Stopping Docker Desktop (for exclusive VHDX access)...")
    stop_processes(ENGINE_PROCESSES)
    if admin:
        stop_service("com.docker.service")
    else:
        print("  [WARN] Not Admin -- skipping service stop (process kill only)")

    # --- Step 4: WSL shutdown ---
    print("Shutting down WSL...")
    ok, output = wsl_shutdown(timeout=30)
    for line in output:
        print(f"  {line}")
    if not ok:
        errors += ["=== wsl --shutdown failed ===", *output, ""]
        print("  [WARN] wsl --shutdown failed")
    else:
        print("  Done.")

    # --- Step 5: Compact VHDX ---
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

    # --- Step 6: relaunch the engine and confirm it comes back ---
    # Gentle bring-up first (Step 3 already stopped cleanly). If it stalls, auto-
    # escalate to the full recovery (kill + service bounce) instead of leaving the
    # user on a wedged "Starting the Docker Engine" -- exactly the incident this
    # whole guard exists to prevent.
    if admin:
        start_service("com.docker.service")
    print(f"Relaunching Docker Desktop (waiting up to {ENGINE_POLL_TIMEOUT}s for engine)...")
    launch_docker_desktop()
    ready = dc.poll_until(
        docker_info_ok, timeout=ENGINE_POLL_TIMEOUT, interval=ENGINE_POLL_INTERVAL
    )
    if not ready:
        print("  [WARN] Engine slow to start -- auto-escalating to full recovery...")
        ready = restart_engine(poll_timeout=ENGINE_POLL_TIMEOUT, poll_interval=ENGINE_POLL_INTERVAL)
    if ready:
        print("  Engine is ready.")
    else:
        errors += engine_down_error()
        print("  [WARN] Docker engine did not come back -- see recovery hint in artifact")

    # --- Step 7: bring the stack back up and wait for it to settle ---
    # Step 1's `compose down` removed the containers; without this the task ends
    # with the stack down and the user has to remember `docker compose up -d`.
    # Skipped when the engine never came back (compose would just error).
    if ready:
        if step("Restarting stack", ["docker", "compose", "up", "-d"]):
            print(f"Waiting for stack to settle (timeout {STACK_POLL_TIMEOUT}s)...")

            # all_containers=False: the one-shot init services (jambonz-db-init,
            # minio-init) exit 0 by design; with -a their "Exited (0)" would read
            # as sick forever. Crash-looping services still show as "Restarting".
            def stack_probe() -> bool:
                lines, code, timed_out = dc.docker_ps(
                    "{{.Names}}|{{.Status}}", all_containers=False
                )
                if code != 0 or timed_out:
                    return False
                return stack_settled(dc.parse_status_entries(lines, dc.project_name()))

            if dc.poll_until(stack_probe, timeout=STACK_POLL_TIMEOUT, interval=STACK_POLL_INTERVAL):
                print("  Stack is up and healthy.")
            else:
                lines, _, _ = dc.docker_ps("{{.Names}}|{{.Status}}", all_containers=False)
                entries = dc.parse_status_entries(lines, dc.project_name())
                sick = dc.sick_services(entries) or [
                    svc for svc, st in entries if dc.STARTING_RE.search(st)
                ]
                errors += [
                    f"=== Stack did not settle within {STACK_POLL_TIMEOUT}s after compose up ===",
                    f"Sick/starting services: {', '.join(sick) or '(none reported -- docker ps failed?)'}",
                    "Diagnose with: python scripts/docker-status.py",
                    "",
                ]
                print("  [WARN] Stack did not settle -- run scripts/docker-status.py to diagnose")
    else:
        print("Skipping stack restart -- engine is down.")

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
