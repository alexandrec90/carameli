"""The host fallback tier of `scripts/run-tests.py`: pytest on the host against a
worktree's compose db and redis.

The app container is the normal home for pytest, but an
ephemeral worktree box routinely has db+redis up and no app container -- and the
run then ended at `docker compose exec`'s "No such container", which
`diagnostics.get_skip_reason` classifies as an environmental skip. The suite is
perfectly runnable there: `.devkit.toml [db]` already describes how to reach db and
redis over their published compose ports, which is what the stop hook's own DB tier
uses. Try that before giving up. With nothing up at all, `changed_test_files` is what
`--changed` can still run on the host.

Split out of `run-tests.py`, which was past its `file_lines` and `definitions`
ceilings with this block as its clearest seam. The runner imports
`host_db_fallback()` and `app_container_running()` by name, so a test can still
repoint either there.
"""

import os
import subprocess
from pathlib import Path

import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]
CFG = script_common.load_script("scripts/hooks/harness_config.py").load(REPO_ROOT)


def _compose_running_services(repo_root: Path = REPO_ROOT) -> set[str]:
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--services", "--status", "running"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    return set(result.stdout.split()) if result.returncode == 0 else set()


def parse_host_port(output: str) -> str | None:
    """Host port from `docker compose port` output ('0.0.0.0:5432', '[::]:5432'). Pure."""
    line = next((ln for ln in reversed(output.splitlines()) if ln.strip()), "")
    if ":" not in line:
        return None
    port = line.rsplit(":", 1)[1].strip()
    return port if port.isdigit() else None


def _compose_host_port(
    service: str, container_port: int, repo_root: Path = REPO_ROOT
) -> str | None:
    try:
        result = subprocess.run(
            ["docker", "compose", "port", service, str(container_port)],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_host_port(result.stdout) if result.returncode == 0 else None


def host_db_env(repo_root: Path = REPO_ROOT) -> dict[str, str] | None:
    """Env pointing host pytest at db+redis over their published ports, or None when
    a port cannot be resolved (the containers are not actually up)."""
    db = CFG.db
    db_port = _compose_host_port(db.db_service, db.db_port, repo_root)
    redis_port = _compose_host_port(db.redis_service, db.redis_port, repo_root)
    if not db_port or not redis_port:
        return None
    db_url = f"{db.url_scheme}://{db.user}:{db.password}@localhost:{db_port}/{db.name}"
    env: dict[str, str] = {name: db_url for name in db.url_env}
    env[db.redis_env] = f"redis://localhost:{redis_port}"
    # `[db].name` is a disposable database on purpose -- the suite TRUNCATEs every
    # table in whatever DATABASE_URL names.
    for name, default in db.test_env.items():
        env[name] = os.environ.get(name, default)
    return env


def app_container_running(repo_root: Path = REPO_ROOT) -> bool:
    """Whether `docker compose exec app` has a container to reach.

    False with Docker Desktop stopped too: `_compose_running_services` answers an
    unreachable daemon with an empty set, which is the case this exists for.
    """
    return "app" in _compose_running_services(repo_root)


def host_db_fallback(repo_root: Path = REPO_ROOT) -> dict[str, str] | None:
    """The env for the host tier, or None to stay with the app container.

    None whenever the container tier is the right answer -- the app service is up, the
    project has no `[db]` tier, or db/redis are not both running. Never guesses: with
    no reachable database the container's own error is the more useful failure.
    """
    if not CFG.db.enabled:
        return None
    running = _compose_running_services(repo_root)
    if "app" in running or not set(CFG.db.services).issubset(running):
        return None
    env = host_db_env(repo_root)
    if env is not None:
        ensure_test_database(repo_root)
    return env


def ensure_test_database(repo_root: Path = REPO_ROOT, runner=subprocess.run) -> bool:
    """Create `[db].name` in the compose db when it is not there. True when it exists.

    The image's `POSTGRES_DB` makes only `carameli`, so a worktree's own compose volume --
    fresh on its first `docker compose up -d db redis` -- had no `carameli_test`, and every
    DB test on the host tier failed with `InvalidCatalogNameError` until someone ran
    `CREATE DATABASE` by hand. The schema is not this function's: `tests/conftest.py`
    migrates whatever database it is pointed at. Fails open -- a db that cannot be asked
    leaves the test run's own connection error to say so.
    """
    db = CFG.db
    # `createdb` rather than SQL: the name goes over as one argv element, never quoted
    # into a statement, and "already exists" is the answer for every volume but the first.
    argv = ["docker", "compose", "exec", "-T", db.db_service, "createdb", "-U", db.user, db.name]
    try:
        done = runner(argv, cwd=repo_root, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0 or "already exists" in (done.stderr or "")


# Where a changed module's test file is looked for, and the trees the default suite never
# collects (`_ADDOPTS`' `--ignore`s): a paid or live test is not "the changed set's".
_TEST_ROOTS = ("tests", "scripts/hooks/tests")
_UNCOLLECTED = (
    "tests/e2e/",
    "tests/live_e2e/",
    "tests/local_e2e/",
    "tests/load/",
    "tests/quarantine/",
)


def changed_test_files(paths: list[str], repo_root: Path = REPO_ROOT) -> list[str]:
    """The test files a changed set names, for `--changed` with no app container up.

    testmon's index lives in the container's tree, so with no container there is nothing
    to select with -- and `--changed` used to go to `docker compose exec` regardless and
    die on `service "app" is not running`, reported as a skipped critical target. This is
    the selection the host can make: a changed `test_*.py` itself, and `test_<stem>.py`
    under the test roots for any other changed `.py` (`run-tests.py` -> `test_run_tests.py`).
    """
    found: list[str] = []
    for raw in paths:
        posix = raw.replace("\\", "/")
        name = posix.rsplit("/", 1)[-1]
        if not name.endswith(".py"):
            continue
        if name.startswith("test_"):
            hits = [posix]
        else:
            pattern = "test_" + name[:-3].replace("-", "_") + ".py"
            hits = sorted(
                hit.relative_to(repo_root).as_posix()
                for test_root in _TEST_ROOTS
                for hit in (repo_root / test_root).rglob(pattern)
            )
        for hit in hits:
            if (
                hit not in found
                and not hit.startswith(_UNCOLLECTED)
                and (repo_root / hit).is_file()
            ):
                found.append(hit)
    return found
