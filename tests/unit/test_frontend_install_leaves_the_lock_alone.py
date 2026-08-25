"""The dev frontend container must never rewrite the lockfile it is mounted over.

`/app` is a **bind mount of the host's `frontend/`**, so anything the container writes
lands in the working tree. `npm install` writes `package-lock.json` -- the node image's
npm strips the `libc` fields the committed lock carries -- which meant every single
`docker compose up` left a tracked file modified before anyone had edited anything.

On a normal checkout that is a confusing `git status`. In an ephemeral worktree box it
is fatal, and this is the failure that produced the test: devkit's `worktree.py` refuses
to reap a box that holds a tracked change, on **any** verdict, because a tracked change
is the one thing that might be somebody's unshipped work. So a preview box whose PR had
already merged could never be reaped, and it kept its port slot forever. Three of those
accumulated, the 16-slot registry filled, and `Preview: Open a UI Branch` began failing
outright -- an unreviewable UI branch, traced back through a full registry, to a
lockfile nobody had touched.

devkit fixed its half (provisioning installs with `ci` when a lock is present). The
container is the **second writer** and needed the same answer; nothing upstream can fix
it, because the command lives here.

Two invariants, and both matter:

- **`ci`, never `install`.** `ci` installs the lock exactly and never rewrites it, which
  is what the lock is for. Only the write matters here, not reproducibility -- but they
  happen to be the same fix.
- **Guarded by a stamp.** `ci` deletes and reinstalls `node_modules`, which is a named
  volume that otherwise survives a restart, so running it unconditionally would turn
  every `compose restart` into a full reinstall. The stamp is compared against the lock
  with `-nt`, so a changed lock still reinstalls and an ordinary restart does not.
  Measured in the box: fresh up installs, restart reaches `ready in 657 ms`.

A test rather than a comment because the tempting repair for a slow dev start is to drop
the `ci` back to `install`, which restores the original defect silently -- nothing fails,
a box just stops being reapable weeks later.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

COMPOSE_FILE = Path(__file__).resolve().parents[2] / "docker-compose.yml"

#: The mount that makes any container write a working-tree change.
FRONTEND_BIND = "./frontend:/app"


@pytest.fixture(scope="module")
def frontend() -> dict:
    compose = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8"))
    return compose["services"]["frontend"]


@pytest.fixture(scope="module")
def command(frontend: dict) -> str:
    raw = frontend["command"]
    return raw if isinstance(raw, str) else " ".join(raw)


def test_the_frontend_still_bind_mounts_the_working_tree(frontend: dict):
    # The premise of everything below. If this mount ever goes, the container writes
    # into its own layer and none of the rest is load-bearing any more.
    assert FRONTEND_BIND in frontend["volumes"]


def test_the_container_installs_with_ci_so_the_lockfile_is_never_rewritten(command: str):
    assert "npm ci" in command


def test_no_bare_npm_install_survives_anywhere_in_the_command(command: str):
    # `npm ci --no-audit` contains neither, so this cannot pass by accident; a
    # reinstated `npm install &&` fails it.
    assert "npm install" not in command


def test_the_install_is_stamped_so_a_restart_does_not_reinstall(command: str):
    # `-nt` against the lock, not a bare existence check: a new dependency has to land.
    assert ".ci-stamp" in command
    assert "-nt" in command
    assert "package-lock.json" in command


def test_the_dev_server_still_starts_after_the_guard(command: str):
    # The guard is a prefix, not a replacement -- `|| { ... }` must not swallow the run.
    assert "npm run dev" in command
