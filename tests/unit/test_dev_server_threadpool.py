"""Polling the bind mount must not be able to starve the dev server.

`CHOKIDAR_USEPOLLING=true` is mandatory on Windows -- inotify does not cross the 9p
bind mount, so without it Vite's watcher never fires and HMR silently dies. The cost
was understood as CPU and tuned with the poll *interval*
(`frontend/devWatchPolicy.ts`). That is real, and it is the smaller half.

The larger half is latency, and it is invisible in a CPU graph. Chokidar stats every
watched path on **libuv's threadpool, which defaults to four threads**, and Vite serves
static files through `sirv` -> `fs.read` from that *same* pool. So a poll sweep does not
merely burn a core: it puts every asset request in a queue behind itself. Measured in
the running container, the 8 comic-book panel images requested in parallel exactly as
the browser preloads them:

    polling on,  UV_THREADPOOL_SIZE=4 (Node default)   35.3 s
    polling off, UV_THREADPOOL_SIZE=4                   1.7 s
    polling on,  UV_THREADPOOL_SIZE=64                  1.4 s

Same bytes, same polling, 25x.

**This is a config invariant test, not a benchmark, and that is deliberate.** A timing
assertion for this would be flaky on a shared runner and would measure the runner's disk
rather than the defect. The defect is exactly expressible as a relationship between two
environment variables, so it is asserted as one: enabling polling without raising the
pool is the bug, and that pairing is what can never come back.

The middle row above is why a test is warranted at all. Deleting `CHOKIDAR_USEPOLLING`
"fixes" the slowness too -- so the tempting repair for the *next* person who hits a slow
dev server is the one that silently kills HMR. Both variables are pinned here so that
trade is made deliberately rather than by accident.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

COMPOSE_FILE = Path(__file__).resolve().parents[2] / "docker-compose.yml"

#: Node's built-in default. At this value a poll sweep and a static response contend.
NODE_DEFAULT_THREADPOOL = 4

#: Enough headroom that a sweep cannot occupy every thread. These are blocking 9p
#: stat calls rather than CPU work, so oversubscribing the 4-core WSL VM is the point:
#: threads parked in a syscall cost memory, not scheduler time.
MIN_THREADPOOL_SIZE = 32


def _environment(service: str) -> dict[str, str]:
    """A service's `environment:` as a dict, accepting either compose spelling."""
    data = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8"))
    raw = (data.get("services") or {}).get(service, {}).get("environment") or []
    if isinstance(raw, dict):
        return {str(k): str(v) if v is not None else "" for k, v in raw.items()}
    pairs = (str(entry).split("=", 1) for entry in raw)
    return {p[0]: (p[1] if len(p) > 1 else "") for p in pairs}


def _truthy(value: str) -> bool:
    """Chokidar treats any non-empty value as enabling polling."""
    return value.strip() not in ("", "false", "0")


def test_frontend_polls_so_hmr_survives_the_bind_mount() -> None:
    env = _environment("frontend")

    assert _truthy(env.get("CHOKIDAR_USEPOLLING", "")), (
        "CHOKIDAR_USEPOLLING was dropped from the frontend service. Windows bind "
        "mounts deliver no inotify events, so Vite's watcher goes silent and HMR "
        "dies with no error -- edits simply stop appearing. If this was done to "
        "speed the dev server up, raise UV_THREADPOOL_SIZE instead; that is the "
        "variable the slowness actually belongs to."
    )


def test_polling_is_paired_with_a_threadpool_it_cannot_saturate() -> None:
    env = _environment("frontend")
    if not _truthy(env.get("CHOKIDAR_USEPOLLING", "")):
        pytest.skip("polling disabled, so the threadpool cannot be starved by a sweep")

    raw = env.get("UV_THREADPOOL_SIZE")
    assert raw is not None, (
        "The frontend service polls the bind mount but leaves UV_THREADPOOL_SIZE at "
        f"Node's default of {NODE_DEFAULT_THREADPOOL}. Chokidar's stat calls and "
        "sirv's static reads share that pool, so every asset request queues behind a "
        "poll sweep: the 8 comic-book panel images took 35.3s this way and 1.4s with "
        "the pool raised. Set UV_THREADPOOL_SIZE in docker-compose.yml."
    )

    assert raw.isdigit(), f"UV_THREADPOOL_SIZE must be an integer, got {raw!r}"
    assert int(raw) >= MIN_THREADPOOL_SIZE, (
        f"UV_THREADPOOL_SIZE={raw} leaves too little headroom above Node's default "
        f"of {NODE_DEFAULT_THREADPOOL}. A poll sweep of the bind mount must not be "
        f"able to occupy every thread; {MIN_THREADPOOL_SIZE} is the floor."
    )


def test_the_poll_sweep_skips_build_output() -> None:
    """`dist/` is a full copy of `public/`, and Vite does not ignore it by default."""
    policy = (Path(__file__).resolve().parents[2] / "frontend" / "devWatchPolicy.ts").read_text(
        encoding="utf-8"
    )

    assert "**/dist/**" in policy, (
        "devWatchPolicy.ts no longer excludes dist/ from the poll sweep. Vite ignores "
        ".git and node_modules but not dist, which in this repo duplicates every "
        "byte of public/ -- restat'd twice a second for a tree the dev server never "
        "reads from."
    )
