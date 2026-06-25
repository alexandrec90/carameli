"""Tests for the small pure predicates in the docker-*.py runner scripts."""

from conftest import load_module

migrate = load_module("scripts/docker-migrate.py")
restart = load_module("scripts/docker-restart-app.py")
status = load_module("scripts/docker-status.py")


def test_status_source_header():
    # fix-docker locates the producer off this stamp (.claude/rules/diagnostics.md),
    # so the prefix and script path are a contract, not cosmetic.
    assert status.SOURCE == "# source: scripts/docker-status.py"
    assert status.SOURCE.startswith("# source: ")


def test_migrate_app_running():
    assert migrate.app_running(["Up 3 minutes (healthy)"]) is True
    assert migrate.app_running(["running"]) is True
    assert migrate.app_running(["Exited (1)"]) is False
    assert migrate.app_running([]) is False


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
