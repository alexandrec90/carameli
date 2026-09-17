"""Tests for project script entry points with external effects stubbed out."""

from pathlib import Path
from types import SimpleNamespace

from conftest import load_module

archive_done_todos = load_module("scripts/archive-done-todos.py")
docker_down = load_module("scripts/docker-down.py")
docker_fix = load_module("scripts/docker-fix.py")
docker_migrate = load_module("scripts/docker-migrate.py")
docker_prune = load_module("scripts/docker-prune.py")
docker_restart_app = load_module("scripts/docker-restart-app.py")
docker_restart_engine = load_module("scripts/docker-restart-engine.py")
docker_status = load_module("scripts/docker-status.py")
extract_log_errors = load_module("scripts/extract-log-errors.py")
install_pre_commit = load_module("scripts/install-pre-commit.py")
pre_commit = load_module("scripts/pre-commit.py")
run_ci = load_module("scripts/run-ci.py")
run_e2e = load_module("scripts/run-e2e.py")
run_load = load_module("scripts/run-load.py")
run_mutation = load_module("scripts/run-mutation.py")


def test_archive_done_todos_main_updates_the_file(tmp_path, monkeypatch):
    todo = tmp_path / "todo.md"
    todo.write_text("* [x] shipped\n\n## Done\n", encoding="utf-8")
    monkeypatch.setattr(archive_done_todos, "TODO_FILE", todo)

    assert archive_done_todos.main() == 0
    assert todo.read_text(encoding="utf-8").count("* [x] shipped") == 1


def test_docker_down_main_clears_the_artifact_on_success(monkeypatch):
    cleared = []
    monkeypatch.setattr(docker_down.dc, "run", lambda _argv: (["stopped"], 0))
    monkeypatch.setattr(docker_down.dc, "clear_artifact", cleared.append)

    assert docker_down.main() == 0
    assert cleared == [docker_down.ARTIFACT]


def test_docker_fix_main_reports_a_ready_engine_without_real_side_effects(monkeypatch):
    monkeypatch.setattr(docker_fix, "kill_process", lambda _name: [])
    monkeypatch.setattr(docker_fix.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(docker_fix, "wsl_shutdown", lambda timeout: (True, []))
    monkeypatch.setattr(docker_fix, "is_admin", lambda: False)
    monkeypatch.setattr(docker_fix, "expand_state_dirs", lambda: [])
    monkeypatch.setattr(docker_fix, "launch_docker_desktop", lambda: True)
    monkeypatch.setattr(docker_fix.dc, "poll_until", lambda *args, **kwargs: True)
    monkeypatch.setattr(docker_fix.dc, "clear_artifact", lambda _name: None)

    assert docker_fix.main() == 0


def test_docker_migrate_main_runs_alembic_for_a_running_app(monkeypatch):
    monkeypatch.setattr(docker_migrate.dc, "docker_ps", lambda *args, **kwargs: (["Up"], 0, False))
    monkeypatch.setattr(docker_migrate.dc, "run", lambda _argv: (["done"], 0))
    monkeypatch.setattr(docker_migrate.dc, "clear_artifact", lambda _name: None)

    assert docker_migrate.main() == 0


def test_docker_prune_main_uses_the_success_path_without_touching_docker(tmp_path, monkeypatch):
    monkeypatch.setattr(docker_prune, "is_admin", lambda: False)
    monkeypatch.setattr(docker_prune.dc, "run", lambda _argv: ([], 0))
    monkeypatch.setattr(docker_prune, "stop_processes", lambda _processes: None)
    monkeypatch.setattr(docker_prune, "wsl_shutdown", lambda timeout: (True, []))
    monkeypatch.setattr(docker_prune, "vhdx_path", lambda: tmp_path / "missing.vhdx")
    monkeypatch.setattr(docker_prune, "launch_docker_desktop", lambda: True)
    monkeypatch.setattr(docker_prune.dc, "poll_until", lambda *args, **kwargs: True)
    monkeypatch.setattr(docker_prune.dc, "clear_artifact", lambda _name: None)

    assert docker_prune.main([]) == 0


def test_docker_restart_app_main_returns_success_for_a_healthy_restart(monkeypatch):
    monkeypatch.setattr(docker_restart_app.dc, "project_name", lambda: "carameli")
    monkeypatch.setattr(docker_restart_app, "_app_status", lambda: ["Up (healthy)"])
    monkeypatch.setattr(docker_restart_app.dc, "run", lambda _argv: ([], 0))
    monkeypatch.setattr(docker_restart_app.dc, "poll_until", lambda *args, **kwargs: True)
    monkeypatch.setattr(docker_restart_app.dc, "clear_artifact", lambda _name: None)

    assert docker_restart_app.main() == 0


def test_docker_restart_engine_main_propagates_success(monkeypatch):
    monkeypatch.setattr(docker_restart_engine, "restart_engine", lambda **kwargs: True)

    assert docker_restart_engine.main() == 0


def test_docker_status_main_writes_diagnostics_without_running_docker(monkeypatch):
    written = []
    monkeypatch.setattr(docker_status.dc, "project_name", lambda: "carameli")
    monkeypatch.setattr(docker_status.dc, "ensure_docker_log_dir", lambda: None)
    monkeypatch.setattr(
        docker_status.dc, "run_with_timeout", lambda *args, **kwargs: ([], 0, False)
    )
    monkeypatch.setattr(docker_status.dc, "docker_ps", lambda *args, **kwargs: ([], 0, False))
    monkeypatch.setattr(docker_status.dc, "write_artifact", lambda name, text: written.append(name))

    assert docker_status.main() == 0
    assert written == [docker_status.CONFIG, docker_status.HEALTH, docker_status.APP_LOGS]


def test_extract_log_errors_main_creates_an_empty_artifact_when_no_logs_exist(
    tmp_path, monkeypatch
):
    artifact = tmp_path / "errors.log"
    monkeypatch.setattr(extract_log_errors, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(extract_log_errors, "ARTIFACT", artifact)
    monkeypatch.setattr(extract_log_errors, "collect_log_files", lambda: [])

    assert extract_log_errors.main() == 0
    assert artifact.read_text(encoding="utf-8") == ""


def test_install_pre_commit_main_succeeds_when_there_are_no_hook_files(monkeypatch):
    monkeypatch.setattr(install_pre_commit, "_install", lambda: 0)
    monkeypatch.setattr(install_pre_commit, "HOOK_FILES", ())
    monkeypatch.setattr(install_pre_commit, "STALE_HOOK_FILES", ())

    assert install_pre_commit.main() == 0


def test_pre_commit_main_returns_the_pass_result(tmp_path, monkeypatch):
    monkeypatch.setattr(pre_commit, "ARTIFACT", tmp_path / "pre-commit-errors.log")
    monkeypatch.setattr(pre_commit, "_activate_venv", lambda: None)
    monkeypatch.setattr(pre_commit, "_git_dirty_files", lambda: [])
    monkeypatch.setattr(pre_commit, "_mtimes", lambda _files: {})
    monkeypatch.setattr(pre_commit, "_run_pre_commit", lambda: ([], 0))
    monkeypatch.setattr(pre_commit, "_pass", lambda _label: 0)

    assert pre_commit.main() == 0


def test_run_ci_main_runs_both_unit_stages_before_skipping_e2e(monkeypatch):
    stages = []
    monkeypatch.setattr(run_ci, "_stage", lambda label, argv: stages.append(label) or 0)

    assert run_ci.main(["--skip-e2e"]) == 0
    assert stages == ["Stage 1: Backend tests", "Stage 2: Frontend unit tests"]


def test_run_e2e_main_reports_an_environment_skip(tmp_path, monkeypatch):
    python = tmp_path / "python"
    python.touch()
    reports = []
    monkeypatch.setattr(run_e2e.script_common, "venv_exe", lambda _name: python)
    monkeypatch.setattr(run_e2e, "get_unreachable_preflight_urls", lambda: ["frontend"])
    monkeypatch.setattr(
        run_e2e.script_common,
        "emit_report",
        lambda **kwargs: reports.append(kwargs) or 0,
    )

    assert run_e2e.main([]) == 0
    assert reports[0]["failed"] is False


def test_run_load_main_returns_the_load_runner_status(tmp_path, monkeypatch):
    monkeypatch.setattr(run_load, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        run_load.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=7),
    )

    assert run_load.main(["--users", "3"]) == 7
    assert (tmp_path / "reports").is_dir()


def test_run_mutation_main_writes_the_results_report(tmp_path, monkeypatch):
    calls = []

    def fake_run(argv, **kwargs):
        calls.append(argv)
        if argv[-1] == "results":
            return SimpleNamespace(returncode=0, stdout="survived: 2\n")
        return SimpleNamespace(returncode=1, stdout=None)

    monkeypatch.setattr(run_mutation, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(run_mutation, "venv_exe", lambda _name: Path("mutmut"))
    monkeypatch.setattr(run_mutation.subprocess, "run", fake_run)

    assert run_mutation.main() == 0
    assert calls == [["mutmut", "run"], ["mutmut", "results"]]
    assert (tmp_path / "reports" / "mutation-report.txt").read_text(encoding="utf-8") == (
        "survived: 2\n"
    )
