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
    assert c.frontend.typecheck_cmd == ("run", "typecheck")
