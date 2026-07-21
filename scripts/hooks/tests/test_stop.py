"""Unit tests for the portable Stop hook snapshot logic."""

from conftest import load_module

hook = load_module("scripts/hooks/stop.py")


def test_no_profile_is_noop(tmp_path):
    profile = tmp_path / "skills-profile.json"
    snapshot = tmp_path / "skills-profile.optimized.json"
    assert hook.save_snapshot(profile, snapshot) == 0
    assert not snapshot.exists()


def test_profile_present_saves_snapshot(tmp_path):
    profile = tmp_path / "skills-profile.json"
    snapshot = tmp_path / "skills-profile.optimized.json"
    profile.write_text('{"fix-tests": {"invocations": 3}}')

    assert hook.save_snapshot(profile, snapshot) == 0
    assert snapshot.exists()
    assert snapshot.read_text() == profile.read_text()


def test_snapshot_overwrites_previous(tmp_path):
    profile = tmp_path / "skills-profile.json"
    snapshot = tmp_path / "skills-profile.optimized.json"
    snapshot.write_text('{"stale": true}')
    profile.write_text('{"fresh": true}')

    assert hook.save_snapshot(profile, snapshot) == 0
    assert snapshot.read_text() == '{"fresh": true}'


def test_copy_failure_returns_one(tmp_path):
    profile = tmp_path / "skills-profile.json"
    profile.write_text("{}")
    # Destination directory does not exist -> shutil.copy2 raises OSError
    snapshot = tmp_path / "missing-dir" / "snap.json"

    assert hook.save_snapshot(profile, snapshot) == 1


def test_should_normalize_requires_opt_in():
    assert hook.should_normalize({"CARAMELI_NORMALIZE_KNOWN_FIXES_ON_STOP": "1"}) is True
    assert hook.should_normalize({"CARAMELI_NORMALIZE_KNOWN_FIXES_ON_STOP": "0"}) is False
    assert hook.should_normalize({}) is False


def test_skin_changed_detects_porcelain_lines():
    assert hook.skin_changed(" M frontend/src/skins/carameli/Tile.tsx\n") is True
    assert hook.skin_changed("") is False
    assert hook.skin_changed("\n  \n") is False


def test_finalize_targets_cover_state_driven_skills():
    skills = {skill for skill, _ in hook.FINALIZE_TARGETS}
    assert skills == {"audit-design-flaws", "make-tests", "make-frontend-tests", "refactor"}


def test_archive_targets_present_with_transcript():
    payload = '{"transcript_path": "/x/session.jsonl", "cwd": "/repo"}'
    assert hook.archive_targets_present(payload) is True


def test_archive_targets_present_without_transcript():
    assert hook.archive_targets_present('{"cwd": "/repo"}') is False
    assert hook.archive_targets_present('{"transcript_path": ""}') is False


def test_archive_targets_present_rejects_non_object_and_garbage():
    assert hook.archive_targets_present("[1, 2, 3]") is False
    assert hook.archive_targets_present("not json") is False
    assert hook.archive_targets_present("") is False


# --- pre-stop verification --------------------------------------------------


def test_stop_hook_active_true_only_when_flagged():
    assert hook.stop_hook_active('{"stop_hook_active": true}') is True
    assert hook.stop_hook_active('{"stop_hook_active": false}') is False
    assert hook.stop_hook_active('{"cwd": "/repo"}') is False
    assert hook.stop_hook_active("not json") is False
    assert hook.stop_hook_active("[1, 2]") is False


def test_verify_enabled_opt_out():
    assert hook.verify_enabled({}) is True
    assert hook.verify_enabled({"CARAMELI_SKIP_STOP_VERIFY": "0"}) is True
    assert hook.verify_enabled({"CARAMELI_SKIP_STOP_VERIFY": "1"}) is False


def test_changed_paths_parses_status_and_renames():
    porcelain = " M app/main.py\n?? scripts/new.py\nR  app/old.py -> app/renamed.py\n\n"
    assert hook.changed_paths(porcelain) == [
        "app/main.py",
        "scripts/new.py",
        "app/renamed.py",
    ]


def test_changed_paths_empty():
    assert hook.changed_paths("") == []


def test_path_predicates():
    assert hook._is_py("app/x.py") and hook._is_py("app/y.pyi")
    assert not hook._is_py("README.md")
    assert hook._is_frontend("frontend/src/App.tsx")
    assert not hook._is_frontend("frontend/vite.config.ts")
    assert hook._is_reqs("requirements.txt")
    assert hook._is_reqs("requirements-dev.in")
    assert not hook._is_reqs("app/requirements_notes.md")
    assert hook._is_script("scripts/hooks/stop.py")
    assert not hook._is_script("scripts/notes.md")
    assert hook._is_app_or_tests("app/main.py") and hook._is_app_or_tests("tests/unit/t.py")
    assert not hook._is_app_or_tests("scripts/x.py")


def test_select_checks_empty_diff_runs_nothing():
    assert hook.select_checks([], True) == []


def test_select_checks_app_python_with_stack_runs_lint_and_db_tests():
    checks = hook.select_checks(["app/main.py"], True)
    assert checks == [hook.CHECK_LINT, hook.CHECK_TESTS]


def test_select_checks_app_python_without_stack_skips_db_tests():
    checks = hook.select_checks(["app/main.py"], False)
    assert checks == [hook.CHECK_LINT]


def test_select_checks_scripts_run_host_tests_without_stack():
    # The key stack-down case: a scripts/ change is verified on the host with no
    # Docker, so it is caught even when the DB-backed tier is unavailable.
    checks = hook.select_checks(["scripts/hooks/stop.py"], False)
    assert checks == [hook.CHECK_LINT, hook.CHECK_SCRIPT_TESTS]
    assert hook.CHECK_TESTS not in checks


def test_select_checks_scripts_change_does_not_probe_db_tier():
    # A scripts-only change never adds the in-container DB tier, even stack-up.
    checks = hook.select_checks(["scripts/hooks/stop.py"], True)
    assert checks == [hook.CHECK_LINT, hook.CHECK_SCRIPT_TESTS]


def test_select_checks_reqs_adds_lock_markers():
    checks = hook.select_checks(["requirements.txt"], False)
    assert hook.CHECK_LOCKS in checks and hook.CHECK_TESTS not in checks


def test_select_checks_frontend_adds_vitest():
    checks = hook.select_checks(["frontend/src/App.tsx"], False)
    assert checks == [hook.CHECK_LINT, hook.CHECK_FRONTEND]


def test_select_checks_non_relevant_change_runs_lint_only():
    # A docs edit still runs lint (lint-all --changed self-scopes to a no-op),
    # but never tests / locks / frontend.
    assert hook.select_checks(["README.md"], True) == [hook.CHECK_LINT]


def test_run_checks_skips_missing_tool(monkeypatch):
    monkeypatch.setattr(hook, "_command_for", lambda name: None)
    assert hook.run_checks([hook.CHECK_FRONTEND]) == []


def test_run_checks_collects_failures(monkeypatch):
    import subprocess as sp

    monkeypatch.setattr(hook, "_command_for", lambda name: (["true"], hook.REPO_ROOT, None))
    monkeypatch.setattr(
        hook.subprocess,
        "run",
        lambda *a, **k: sp.CompletedProcess([], 1, "boom\n", "bad line\n"),
    )
    failures = hook.run_checks([hook.CHECK_LINT])
    assert len(failures) == 1
    assert failures[0][0] == hook.CHECK_LINT
    assert "bad line" in failures[0][2]


def test_run_checks_oserror_is_skip_not_failure(monkeypatch):
    def boom(*a, **k):
        raise OSError("no such tool")

    monkeypatch.setattr(hook, "_command_for", lambda name: (["nope"], hook.REPO_ROOT, None))
    monkeypatch.setattr(hook.subprocess, "run", boom)
    assert hook.run_checks([hook.CHECK_LINT]) == []


def test_verify_skips_when_loop_active(monkeypatch):
    monkeypatch.setattr(hook, "run_checks", lambda names: [("lint", None, "x")])
    assert hook.verify('{"stop_hook_active": true}', {}) == 0


def test_verify_skips_when_opted_out(monkeypatch):
    monkeypatch.setattr(hook, "run_checks", lambda names: [("lint", None, "x")])
    assert hook.verify("{}", {"CARAMELI_SKIP_STOP_VERIFY": "1"}) == 0


def test_verify_returns_two_on_failure(monkeypatch):
    monkeypatch.setattr(hook, "_git_status_porcelain", lambda root: " M app/main.py\n")
    monkeypatch.setattr(hook, "stack_app_running", lambda *a, **k: False)
    monkeypatch.setattr(hook, "run_checks", lambda names: [("lint", "logs/lint-errors.log", "")])
    assert hook.verify("{}", {}) == 2


def test_verify_returns_zero_when_clean(monkeypatch):
    monkeypatch.setattr(hook, "_git_status_porcelain", lambda root: " M app/main.py\n")
    monkeypatch.setattr(hook, "stack_app_running", lambda *a, **k: False)
    monkeypatch.setattr(hook, "run_checks", lambda names: [])
    assert hook.verify("{}", {}) == 0


# --- Tier 2b autostart ------------------------------------------------------


def test_autostart_enabled_opt_in():
    assert hook.autostart_enabled({}) is False
    assert hook.autostart_enabled({"CARAMELI_STOP_TESTS_AUTOSTART": "0"}) is False
    assert hook.autostart_enabled({"CARAMELI_STOP_TESTS_AUTOSTART": "1"}) is True


def test_services_to_stop_only_newly_started():
    before = {"redis"}
    after = {"redis", "db", "pgbouncer", "app"}
    assert hook.services_to_stop(before, after) == ["app", "db", "pgbouncer"]
    # Nothing new started -> nothing to stop.
    assert hook.services_to_stop({"app"}, {"app"}) == []


def test_verify_does_not_autostart_when_opted_out(monkeypatch):
    monkeypatch.setattr(hook, "_git_status_porcelain", lambda root: " M app/main.py\n")
    monkeypatch.setattr(hook, "stack_app_running", lambda *a, **k: False)
    called = {"up": False, "stop": False}
    monkeypatch.setattr(hook, "_compose_up_app", lambda *a, **k: called.__setitem__("up", True))
    monkeypatch.setattr(hook, "_compose_stop", lambda *a, **k: called.__setitem__("stop", True))
    seen = {}

    def _record(names):
        seen["names"] = names
        return []

    monkeypatch.setattr(hook, "run_checks", _record)

    assert hook.verify("{}", {}) == 0
    assert called["up"] is False  # autostart off by default
    assert hook.CHECK_TESTS not in seen["names"]  # DB tier skipped


def test_verify_autostarts_and_stops_only_started(monkeypatch):
    monkeypatch.setattr(hook, "_git_status_porcelain", lambda root: " M app/main.py\n")
    monkeypatch.setattr(hook, "stack_app_running", lambda *a, **k: False)
    running = iter([set(), {"db", "redis", "app"}])  # before up, after up
    monkeypatch.setattr(hook, "_compose_running_services", lambda *a, **k: next(running))
    monkeypatch.setattr(hook, "_compose_up_app", lambda *a, **k: True)
    stopped = {}
    monkeypatch.setattr(
        hook, "_compose_stop", lambda services, **k: stopped.setdefault("svc", services)
    )
    seen = {}

    def _record(names):
        seen["names"] = names
        return []

    monkeypatch.setattr(hook, "run_checks", _record)

    assert hook.verify("{}", {"CARAMELI_STOP_TESTS_AUTOSTART": "1"}) == 0
    assert hook.CHECK_TESTS in seen["names"]  # DB tier ran once stack came up
    assert stopped["svc"] == ["app", "db", "redis"]  # only what we started


def test_verify_autostart_failure_skips_tests_and_stops_nothing(monkeypatch):
    monkeypatch.setattr(hook, "_git_status_porcelain", lambda root: " M app/main.py\n")
    monkeypatch.setattr(hook, "stack_app_running", lambda *a, **k: False)
    monkeypatch.setattr(hook, "_compose_running_services", lambda *a, **k: set())
    monkeypatch.setattr(hook, "_compose_up_app", lambda *a, **k: False)  # daemon down
    stopped = {}
    monkeypatch.setattr(
        hook, "_compose_stop", lambda services, **k: stopped.setdefault("svc", services)
    )
    seen = {}

    def _record(names):
        seen["names"] = names
        return []

    monkeypatch.setattr(hook, "run_checks", _record)

    assert hook.verify("{}", {"CARAMELI_STOP_TESTS_AUTOSTART": "1"}) == 0
    assert hook.CHECK_TESTS not in seen["names"]  # up failed -> DB tier skipped
    assert stopped["svc"] == []  # nothing started -> nothing stopped
