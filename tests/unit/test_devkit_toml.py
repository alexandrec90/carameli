"""Contract tests for this repo's own `.devkit.toml`.

The harness reads this file; nothing in the application does, so a wrong value here fails
silently — the tier it configures simply never fires, and a scheduled job reports success
having done nothing. That is not hypothetical: the nightly `docker-stop-idle` job was
registered on 2026-08-17 and, as of 2026-08-21, had never stopped a single stack, because
no project in the workspace had ever opted in. Nothing noticed for four days.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEVKIT_TOML = REPO_ROOT / ".devkit.toml"


def load() -> dict:
    return tomllib.loads(DEVKIT_TOML.read_text(encoding="utf-8"))


def test_the_manifest_parses() -> None:
    assert load(), f"{DEVKIT_TOML} is empty or unreadable"


def test_the_nightly_pass_is_allowed_to_stop_this_stack() -> None:
    """`[docker] auto_stop = true`, and it has to be the literal boolean.

    devkit's reader is `raw.get("auto_stop") is True`, so `"true"`, `1` and `"yes"` all
    read as opted *out* — silently, which is the failure mode this asserts against.

    Why this stack opts in at all: with app, worker and frontend up, the Windows-side
    `com.docker.backend.exe` burned 255% of one core, and 209% within 229 seconds of a
    cold start. All three bind-mount Windows paths and their reloaders stat those trees
    continuously across the 9p bridge — ~550 ioctls/s moving 21 KB/s, about 39 bytes an
    operation, so metadata churn rather than work. Stopping the containers took it to
    11.2%; restarting Docker did not help, and `.wslconfig`'s `processors=4` bounds the
    WSL VM rather than that Windows process.
    """
    assert load()["docker"]["auto_stop"] is True


def test_a_box_derives_its_cors_origin_from_its_own_frontend_port() -> None:
    """`[worktree.env] CORS_ORIGINS` must name the box's own frontend port.

    Without it, seeding copies this checkout's `CORS_ORIGINS=*` into the box, and
    `app/main.py` replaces a wildcard with `DEFAULT_FRONTEND_ORIGIN` because the CORS
    spec forbids `*` alongside `allow_credentials=True`. The box's app then allows only
    the *primary's* `http://localhost:5173` and rejects every request the box's own
    frontend makes — a preview whose console is nothing but preflight failures.

    The template has to be spelled with `${FRONTEND_HOST_PORT}` exactly: devkit expands
    it against the managed block it writes, and a template naming anything else is
    dropped rather than written half-expanded, which leaves the seeded wildcard in force
    with nothing to say it happened.
    """
    assert load()["worktree"]["env"]["CORS_ORIGINS"] == "http://localhost:${FRONTEND_HOST_PORT}"


def test_the_docker_table_carries_no_key_the_harness_will_not_read() -> None:
    """A misspelled key here is not an error anywhere — devkit's reader takes the keys it
    knows and ignores the rest, so `auto-stop` or `autostop` would leave the stack opted
    out while this file looks like it opted in.

    The stack's ports are deliberately not asserted: `keep_reason` reads those from
    Docker's own labels on the running containers, not from this file, so there is
    nothing here to keep in step with them.
    """
    assert set(load()["docker"]) == {"auto_stop"}
