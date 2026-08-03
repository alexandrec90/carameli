"""Tests for the small pure predicates in the docker-*.py runner scripts."""

from conftest import load_module

migrate = load_module("scripts/docker-migrate.py")
restart = load_module("scripts/docker-restart-app.py")
status = load_module("scripts/docker-status.py")
prune = load_module("scripts/docker-prune.py")
revision = load_module("scripts/db-revision.py")


def test_status_source_header():
    # The prefix and script path identify how to regenerate the artifact.
    assert status.SOURCE == "# source: scripts/docker-status.py"
    assert status.SOURCE.startswith("# source: ")


def test_status_sick_re_exited_zero_is_healthy():
    # One-shot init services (minio-init, jambonz-db-init) exit 0 on success and
    # must not land in health.log's "Unhealthy/exited services" triage.
    assert not status._SICK_RE.search("Exited (0) About an hour ago")
    assert status._SICK_RE.search("Exited (1) 5 minutes ago")
    assert status._SICK_RE.search("Up 2 minutes (unhealthy)")


def test_migrate_app_running():
    assert migrate.app_running(["Up 3 minutes (healthy)"]) is True
    assert migrate.app_running(["running"]) is True
    assert migrate.app_running(["Exited (1)"]) is False
    assert migrate.app_running([]) is False


def test_revision_reuses_the_same_app_probe_as_migrate():
    # Both need the app container up, and `docker ps --filter` is used rather than
    # `docker compose ps` because the latter hangs on Compose v2 when a container
    # is unhealthy — the exact state you are in when you go looking.
    assert revision.app_running(["Up 3 minutes (healthy)"]) is True
    assert revision.app_running(["Exited (1)"]) is False
    assert revision.app_running([]) is False


def test_revision_quotes_a_message_that_would_otherwise_reach_the_shell():
    # The message is free text from a VS Code prompt and is interpolated into an
    # `sh -c` string inside the container (the PgBouncer bypass needs the shell to
    # expand $DIRECT_DATABASE_URL). Quoting is what keeps a quote or a `;` inert.
    assert revision.shell_quote("add index") == "'add index'"
    assert revision.shell_quote("it's fine") == "'it'\\''s fine'"
    assert revision.shell_quote("x; rm -rf /") == "'x; rm -rf /'"


def test_revision_rewrites_the_container_path_to_a_repo_relative_one():
    # Alembic prints /app/alembic/versions/..., which does not exist on the host —
    # and the whole reason to print it is that someone opens it in the editor.
    out = ["  Generating /app/alembic/versions/9f2_add_call_index.py ...  done"]
    assert revision.created_paths(out) == ["alembic/versions/9f2_add_call_index.py"]


def test_revision_reports_nothing_when_alembic_generated_nothing():
    # "No changes in schema detected" is a successful run that wrote no file; it must
    # not be reported as a written revision.
    assert revision.created_paths(["INFO  [alembic.env] No changes in schema detected."]) == []


def test_restart_app_present():
    assert restart.app_present(["Up (healthy)"]) is True
    assert restart.app_present(["Restarting"]) is True
    assert restart.app_present(["Exited (0)"]) is False


def test_restart_app_healthy():
    assert restart.app_healthy(["Up 2 minutes (healthy)"]) is True
    assert restart.app_healthy(["Up 2 minutes (starting)"]) is False


def test_restart_app_broken():
    assert restart.app_broken(["unhealthy"]) is True
    assert restart.app_broken(["Exited (1)"]) is True
    assert restart.app_broken(["Up (healthy)"]) is False


def test_prune_default_keeps_stack_images():
    # Default mode prunes only *dangling* images/cache (-f), so the stack's tagged
    # base images survive and the next `up` doesn't re-pull multi-GB images.
    argvs = [argv for _, argv in prune.prune_steps(deep=False)]
    assert ["docker", "image", "prune", "-f"] in argvs
    assert ["docker", "builder", "prune", "-f"] in argvs
    assert ["docker", "image", "prune", "-af"] not in argvs


def test_prune_deep_removes_all_unused():
    # --deep widens to ALL unused images/cache (-af). Guard against a silent
    # downgrade that would make --deep identical to the default.
    argvs = [argv for _, argv in prune.prune_steps(deep=True)]
    assert ["docker", "image", "prune", "-af"] in argvs
    assert ["docker", "builder", "prune", "-af"] in argvs


def test_prune_stack_settled():
    # Settled = at least one container, none sick, none still starting.
    assert prune.stack_settled([]) is False
    assert prune.stack_settled([("app", "Up 30 seconds (healthy)")]) is True
    # No-healthcheck services ("Up N seconds" plain) count as settled.
    assert (
        prune.stack_settled([("worker", "Up 30 seconds"), ("app", "Up 1 minute (healthy)")]) is True
    )
    # Mid-boot healthcheck must NOT settle -- jambonz takes ~30-60s.
    assert prune.stack_settled([("jambonz", "Up 5 seconds (health: starting)")]) is False
    # Sick containers never settle.
    assert prune.stack_settled([("rtpengine", "Restarting (255) 2 seconds ago")]) is False
    assert prune.stack_settled([("app", "Up (healthy)"), ("db", "Up (unhealthy)")]) is False


def test_prune_never_touches_volumes():
    # `docker compose down` (step 1) detaches named volumes; a --volumes prune
    # would then delete carameli_pgdata et al. This must never regress -- in EITHER mode.
    for deep in (False, True):
        for _, argv in prune.prune_steps(deep=deep):
            assert "--volumes" not in argv


def test_prune_engine_down_error_points_to_recovery():
    # If the engine doesn't come back even after auto-recovery, the artifact must
    # name the recovery script -- that's the whole point of the post-compaction verify.
    lines = prune.engine_down_error()
    assert any("docker-restart-engine.py" in ln for ln in lines)
    assert any(str(prune.ENGINE_POLL_TIMEOUT) in ln for ln in lines)


def test_recovery_logic_is_shared_not_duplicated():
    # Both the prune auto-recovery and the recovery task must call the SAME
    # restart_engine, and the stop-before-compaction must use the SAME process
    # list -- any drift reintroduces the VHDX-remount race that wedged the engine.
    import docker_win

    restart_engine_mod = load_module("scripts/docker-restart-engine.py")
    assert prune.restart_engine is docker_win.restart_engine
    assert restart_engine_mod.restart_engine is docker_win.restart_engine
    assert prune.ENGINE_PROCESSES is docker_win.ENGINE_PROCESSES


def test_restart_engine_returns_false_when_desktop_missing(monkeypatch):
    # Docker Desktop exe not found -> bail before polling (don't wait 90s for nothing).
    import docker_common
    import docker_win

    polled = []
    monkeypatch.setattr(docker_win, "is_admin", lambda: False)
    monkeypatch.setattr(docker_win, "stop_processes", lambda procs: None)
    monkeypatch.setattr(docker_win, "wsl_shutdown", lambda: (True, []))
    monkeypatch.setattr(docker_win, "launch_docker_desktop", lambda: False)
    monkeypatch.setattr(docker_common, "poll_until", lambda *a, **k: polled.append(1) or True)

    assert docker_win.restart_engine(poll_timeout=1, poll_interval=1) is False
    assert not polled  # returned before ever polling the engine


def _run_restart_engine(monkeypatch, *, admin):
    """Drive restart_engine with all I/O stubbed; return the recorded call names."""
    import docker_common
    import docker_win

    events = []
    monkeypatch.setattr(docker_win, "is_admin", lambda: admin)
    monkeypatch.setattr(docker_win, "stop_processes", lambda procs: events.append(("stop", procs)))
    monkeypatch.setattr(docker_win, "stop_service", lambda n: events.append(("stop_service", n)))
    monkeypatch.setattr(docker_win, "start_service", lambda n: events.append(("start_service", n)))
    monkeypatch.setattr(docker_win, "wsl_shutdown", lambda: (True, []))
    monkeypatch.setattr(docker_win, "launch_docker_desktop", lambda: True)
    monkeypatch.setattr(docker_common, "poll_until", lambda probe, timeout, interval: True)

    result = docker_win.restart_engine(poll_timeout=1, poll_interval=1)
    assert events[0] == ("stop", docker_win.ENGINE_PROCESSES)
    return result, [e[0] for e in events]


def test_restart_engine_bounces_service_when_admin(monkeypatch):
    result, names = _run_restart_engine(monkeypatch, admin=True)
    assert result is True
    assert "stop_service" in names and "start_service" in names


def test_restart_engine_skips_service_without_admin(monkeypatch):
    result, names = _run_restart_engine(monkeypatch, admin=False)
    assert result is True
    assert "stop_service" not in names and "start_service" not in names
