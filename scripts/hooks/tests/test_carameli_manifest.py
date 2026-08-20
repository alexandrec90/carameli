"""Contract test: `.devkit.toml` reproduces Carameli's harness constants.

**Deliberately NOT in `scripts/sync-devkit.py`'s MANIFEST** — this is the
project-specific half of a test that used to live in the vendored
`test_harness_config.py`. Upstream (devkit `67e6863`) rewrote that file to assert
only *invariants*, because pinning carameli's literals there turned the vendored
suite red in every other consuming repo.

That rewrite is right for the shared file and leaves a real gap here: nothing else
catches a `.devkit.toml` edit that silently changes what the Stop hook does
in *this* repo — points pytest at the wrong directory or hands host pytest the
wrong DB credentials. This file closes that gap on
Carameli's side, where project literals belong.

Keep it in sync with `.devkit.toml`; a deliberate manifest change should
update both in the same commit.
"""

import re
import tomllib

from conftest import REPO_ROOT, load_module

cfg = load_module("scripts/hooks/harness_config.py")


def test_manifest_reproduces_carameli_stop_constants():
    c = cfg.load(REPO_ROOT)

    assert c.env_prefix == "CARAMELI"
    assert c.app_dir == "app/" and c.tests_dir == "tests/" and c.unit_tests == "tests/unit"


def test_manifest_reproduces_carameli_db_tier():
    c = cfg.load(REPO_ROOT)

    assert c.db.enabled is True
    assert c.db.services == ("db", "redis")
    assert c.db.user == "carameli" and c.db.name == "carameli"
    assert c.db.password == "carameli_local_dev"  # pragma: allowlist secret
    assert c.db.url_scheme == "postgresql+asyncpg"
    # Both aliases matter: app code reads DATABASE_URL, alembic DIRECT_DATABASE_URL.
    assert c.db.url_env == ("DATABASE_URL", "DIRECT_DATABASE_URL")
    assert c.db.redis_env == "REDIS_URL"
    assert c.db.test_env == {
        "API_KEY_SECRET": "ci-test-key",  # pragma: allowlist secret
        "SESSION_SECRET": "ci-session-secret",  # pragma: allowlist secret
    }


def test_manifest_reproduces_carameli_frontend_tier():
    c = cfg.load(REPO_ROOT)

    assert c.frontend.enabled is True
    assert c.frontend.dir == "frontend"
    assert c.frontend.src == "frontend/src/"
    assert c.frontend.skin == "frontend/src/skins"
    assert c.frontend.test_cmd == ("run", "test:run")
    # `lint:types` is the script `frontend/package.json` actually defines; the tier
    # was pointed at it in 3c14236 and this assertion was left naming the old one.
    assert c.frontend.typecheck_cmd == ("run", "lint:types")


# The two sections below are read straight from the TOML rather than through
# `harness_config`: `[worktree]` and `[python]` are consumed by devkit's *own*
# copy of that module when `worktree.py` spawns a box, and this repo's vendored
# copy is a release behind it. Going through the vendored copy would make the
# test pass by reading a field that does not exist yet.
def manifest() -> dict:
    return tomllib.loads((REPO_ROOT / ".devkit.toml").read_text(encoding="utf-8"))


def test_a_box_gets_its_own_database_not_the_primary_stacks():
    # Regression, 2026-08-20: seeding copies this checkout's `.env` verbatim, so a
    # box inherited DATABASE_URL naming localhost:5432 — the primary stack's
    # Postgres — while its own compose DB sat on the leased DB_HOST_PORT. That is
    # not a misconfiguration but data loss: tests/conftest.py TRUNCATEs every table
    # in whatever DATABASE_URL names, so a bare `pytest` inside a box emptied the
    # development database. Every URL alias the harness knows about must be
    # re-pointed at the box's own port.
    env = manifest()["worktree"]["env"]
    db = manifest()["db"]

    for alias in db["url_env"]:
        assert alias in env, f"{alias} is not re-pointed for a box"
        assert "${DB_HOST_PORT}" in env[alias]
        assert f"localhost:{db['db_port']}" not in env[alias]


def test_box_env_templates_only_name_ports_devkit_leases():
    # `expand_env_templates` DROPS a template naming something it cannot resolve,
    # which leaves the seeded (wrong) line in force and reports nothing. A typo in
    # a variable name is therefore silent, so pin the spelling here.
    leased = {"COMPOSE_PROJECT_NAME", "APP_HOST_PORT", "DB_HOST_PORT", "REDIS_HOST_PORT",
              "FRONTEND_HOST_PORT", "GRAFANA_HOST_PORT", "PROMETHEUS_HOST_PORT",
              "MINIO_HOST_PORT", "MINIO_CONSOLE_HOST_PORT"}

    for key, template in manifest()["worktree"]["env"].items():
        named = set(re.findall(r"\$\{(\w+)\}", template))
        assert named, f"{key} interpolates nothing, so it is a constant, not a template"
        assert named <= leased, f"{key} names {named - leased}, which no box gets"


def test_manifest_pins_the_python_the_image_runs():
    # Unpinned, `worktree.py` falls back to parsing the Dockerfile and warns on every
    # spawn. The pin is only correct while it agrees with the image.
    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    tags = set(re.findall(r"^FROM python:([0-9.]+)", dockerfile, re.MULTILINE))

    assert len(tags) == 1, f"Dockerfile names more than one Python: {sorted(tags)}"
    assert manifest()["python"]["version"] == tags.pop()
