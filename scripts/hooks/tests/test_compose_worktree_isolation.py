"""Invariants that keep parallel worktree stacks from clobbering each other.

Two git worktrees can run independent Docker stacks side-by-side (README.md,
"Parallel Worktrees"). That only holds if every *locally-built* image is tagged
with the Compose project name — otherwise a `docker compose up --build` in one
worktree overwrites the shared image tag the other worktree's stack builds from
diverging source. PR #69 namespaced the `app`/`worker` image but the `db-backup`
sidecar (which runs in the slim stack both worktrees start) was missed; this test
locks the invariant in so a new `build:` service can't silently reintroduce it.

Stdlib-only text parse (no PyYAML), so it runs in the hook-tests gate step before
the venv is guaranteed, alongside test_ci_workflow_conventions.py.
"""

import re

from conftest import REPO_ROOT

COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"

# `image: <value>` lines, capturing the tag. Anchored to the line so a commented
# `#   image: ...` (leading '#') is excluded.
IMAGE_RE = re.compile(r"^\s*image:\s*(\S+)\s*$")


def _image_tags() -> list[str]:
    tags = []
    for line in COMPOSE_FILE.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("#"):
            continue
        m = IMAGE_RE.match(line)
        if m:
            tags.append(m.group(1))
    return tags


def test_locally_built_images_are_project_namespaced():
    # Locally-built images use the `carameli-` prefix (external images are
    # `postgres:18`, `redis:7-alpine`, `ghcr.io/...`, etc.). Every one of ours
    # must interpolate COMPOSE_PROJECT_NAME so parallel stacks get distinct tags.
    local = [t for t in _image_tags() if t.startswith("carameli-")]
    assert local, "expected at least one locally-built carameli-* image in the compose file"
    offenders = [t for t in local if "${COMPOSE_PROJECT_NAME" not in t]
    assert not offenders, (
        "locally-built images must be namespaced with ${COMPOSE_PROJECT_NAME} so "
        f"parallel worktree stacks don't clobber each other's builds: {offenders}"
    )


def test_app_and_db_backup_images_are_namespaced():
    # Explicit belt-and-suspenders for the two images that exist today, so the
    # generic check above can't pass vacuously if the prefix convention drifts.
    tags = _image_tags()
    assert "carameli-app-${COMPOSE_PROJECT_NAME:-carameli}" in tags
    assert "carameli-db-backup-${COMPOSE_PROJECT_NAME:-carameli}" in tags
