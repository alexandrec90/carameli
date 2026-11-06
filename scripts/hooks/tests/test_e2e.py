"""Tests for scripts/e2e.py, the local end-to-end tier, and the wiring that selects it."""

import configparser
import shlex
import socket
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT, load_module

mod = load_module("scripts/e2e.py")

PORTS = mod.Ports(app=8100, minio=8101, vite=8102)

JUNIT_HEAD = '<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest">'
JUNIT_TAIL = "</testsuite></testsuites>"


def junit(tmp_path: Path, body: str) -> Path:
    report = tmp_path / "junit.xml"
    report.write_text(f"{JUNIT_HEAD}{body}{JUNIT_TAIL}", encoding="utf-8")
    return report


def addopts() -> str:
    ini = configparser.ConfigParser(interpolation=None)
    ini.read(REPO_ROOT / "pytest.ini", encoding="utf-8")
    return ini["pytest"]["addopts"]


# --- the wiring: the default run leaves the tier out, and the tier reaches it ---


def test_default_run_deselects_the_tier():
    assert '-m "not paid and not local"' in addopts()


def test_local_marker_is_declared():
    ini = (REPO_ROOT / "pytest.ini").read_text(encoding="utf-8")
    assert "\n    local:" in ini


def test_every_suite_the_tier_names_exists():
    for suite in mod.SUITES:
        assert (REPO_ROOT / suite).exists(), suite


def test_the_marker_the_tier_selects_excludes_paid():
    # The one safety rule of this repo's tiers: nothing automated reaches a paid test.
    assert mod.MARKER == "local and not paid"


def test_every_nightly_e2e_invocation_selects_the_tier():
    # addopts' `-m` would otherwise deselect every test, and the job would go green on
    # "no tests ran" for as long as nobody read it.
    workflow = (REPO_ROOT / ".github/workflows/nightly.yml").read_text(encoding="utf-8")
    invocations = [line for line in workflow.splitlines() if "run: pytest tests/e2e/" in line]
    assert invocations
    assert all(f'-m "{mod.MARKER}"' in line for line in invocations)


def test_every_named_file_carries_the_marker():
    # tests/e2e is marked by its conftest's hook; a file named here marks itself, or
    # `-m local` selects nothing from it and the default run collects it.
    for suite in mod.SUITES:
        if suite.endswith(".py"):
            text = (REPO_ROOT / suite).read_text(encoding="utf-8")
            assert "pytest.mark.local" in text, suite


def test_the_e2e_directory_marks_itself():
    text = (REPO_ROOT / "tests/e2e/conftest.py").read_text(encoding="utf-8")
    assert "item.add_marker(pytest.mark.local)" in text


# --- the stack: its own project, and no credential ---


def test_compose_names_the_tier_project_and_both_files():
    argv = mod.compose("ps")
    assert argv[:4] == ["docker", "compose", "-p", "carameli-e2e"]
    assert argv.count("-f") == len(mod.COMPOSE_FILES)
    assert argv[-1] == "ps"


def test_every_compose_file_exists():
    for name in mod.COMPOSE_FILES:
        assert (REPO_ROOT / name).is_file(), name


def test_reset_deletes_volumes_of_the_tier_project_only():
    argv = mod.reset_argv()
    assert argv[argv.index("-p") + 1] == mod.PROJECT
    assert "-v" in argv


def test_up_builds_waits_and_names_only_what_the_tier_needs():
    argv = mod.up_argv()
    assert "--build" in argv
    assert "--wait" in argv
    assert argv[-len(mod.SERVICES) :] == list(mod.SERVICES)
    assert "frontend" not in argv
    assert "worker" not in argv


def test_up_names_no_one_shot():
    # `--wait` reads a one-shot's exit 0 as the stack failing:
    # "container carameli-e2e-minio-init-1 exited (0)".
    assert "minio-init" not in mod.up_argv()


def test_buckets_runs_the_one_shot_and_removes_it():
    argv = mod.buckets_argv()
    assert argv[argv.index("run") + 1 :] == ["--rm", "-T", "minio-init"]


def test_migrate_runs_in_the_app_container_without_a_tty():
    argv = mod.migrate_argv()
    assert argv[argv.index("exec") + 1 :] == ["-T", "app", "alembic", "upgrade", "head"]


def test_the_override_keeps_env_file_and_bind_mount_out():
    text = (REPO_ROOT / "tests/e2e/docker-compose.e2e.yml").read_text(encoding="utf-8")
    app = text.split("\n  app:\n")[1]
    assert "env_file: !reset []" in app
    assert "volumes: !reset []" in app
    assert "--reload" not in app


def test_the_override_publishes_on_loopback_only():
    text = (REPO_ROOT / "tests/e2e/docker-compose.e2e.yml").read_text(encoding="utf-8")
    published = [line.strip() for line in text.splitlines() if line.strip().startswith('- "')]
    assert published
    assert all(line.startswith('- "127.0.0.1:') for line in published)


def test_stack_env_overrides_what_the_checkout_or_shell_says():
    base = {
        "COMPOSE_PROJECT_NAME": "carameli",
        "COMPOSE_PROFILES": "telephony",
        "S3_ENDPOINT": "https://s3.example.com",
        "PATH": "kept",
    }
    env = mod.stack_env(base, PORTS, "key")
    assert env["COMPOSE_PROJECT_NAME"] == mod.PROJECT
    assert env["COMPOSE_PROFILES"] == ""
    assert env["S3_ENDPOINT"] == "http://127.0.0.1:8101"
    assert env["PATH"] == "kept"


def test_stack_env_gives_the_tests_every_address():
    env = mod.stack_env({}, PORTS, "key")
    assert env["E2E_API_KEY"] == "key"  # pragma: allowlist secret - test fixture value
    assert env["E2E_BACKEND_URL"] == "http://127.0.0.1:8100"
    assert env["E2E_BASE_URL"] == "http://127.0.0.1:8102"
    assert env["E2E_APP_PORT"] == "8100"
    assert env["E2E_MINIO_PORT"] == "8101"


def test_vite_env_points_the_proxy_at_this_stack_and_forces_the_demo():
    env = mod.vite_env({"VITE_LIVE_BACKEND": "true"}, PORTS)
    assert env["VITE_LIVE_BACKEND"] == "false"
    assert env["VITE_PROXY_TARGET"] == "http://127.0.0.1:8100"
    assert env["VITE_PORT"] == "8102"


def test_vite_argv_is_one_process_on_an_exact_port():
    argv = mod.vite_argv("node", 8102)
    assert argv[0] == "node"
    assert "npm" not in argv
    assert argv[argv.index("--port") + 1] == "8102"
    assert "--strictPort" in argv


def test_free_port_can_be_bound():
    port = mod.free_port()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((mod.LOOPBACK, port))


# --- pytest's argv ---


def test_pytest_argv_runs_the_suites_inside_the_tier(tmp_path):
    argv = mod.pytest_argv("python", tmp_path / "r.xml")
    assert argv[:3] == ["python", "-m", "pytest"]
    assert all(suite in argv for suite in mod.SUITES)
    assert argv[argv.index("-m", 3) + 1] == mod.MARKER
    assert f"--junitxml={tmp_path / 'r.xml'}" in argv
    assert all(f"--browser={browser}" in argv for browser in mod.BROWSERS)


def test_pytest_argv_named_ids_replace_the_suites_and_keep_the_marker(tmp_path):
    argv = mod.pytest_argv("python", tmp_path / "r.xml", ["tests/e2e/test_x.py::test_y"])
    assert "tests/e2e/test_x.py::test_y" in argv
    assert not any(suite in argv for suite in mod.SUITES)
    assert mod.MARKER in argv


# --- reading the report ---


def test_cases_reads_every_outcome(tmp_path):
    report = junit(
        tmp_path,
        '<testcase classname="tests.e2e.test_a" name="test_pass" />'
        '<testcase classname="tests.e2e.test_a" name="test_bad[chromium]">'
        '<failure message="assert 1 == 2">trace</failure></testcase>'
        '<testcase classname="tests.e2e.test_a" name="test_setup">'
        '<error message="fixture broke">trace</error></testcase>'
        '<testcase classname="tests.e2e.test_a" name="test_skip">'
        '<skipped message="no minio" /></testcase>',
    )
    assert mod.cases(report) == [
        mod.Case("tests/e2e/test_a.py::test_pass", "passed"),
        mod.Case("tests/e2e/test_a.py::test_bad[chromium]", "failed", "assert 1 == 2"),
        mod.Case("tests/e2e/test_a.py::test_setup", "error", "fixture broke"),
        mod.Case("tests/e2e/test_a.py::test_skip", "skipped", "no minio"),
    ]


def test_cases_keeps_a_class_in_the_id(tmp_path):
    report = junit(tmp_path, '<testcase classname="tests.e2e.test_a.TestB" name="test_c" />')
    assert mod.cases(report)[0].ident == "tests/e2e/test_a.py::TestB::test_c"


def test_cases_with_no_test_module_in_the_classname_keeps_what_it_has(tmp_path):
    report = junit(tmp_path, '<testcase classname="" name="tests/e2e" />')
    assert mod.cases(report)[0].ident == "tests/e2e"


def test_cases_of_a_missing_report_is_none(tmp_path):
    assert mod.cases(tmp_path / "absent.xml") == []


def test_cases_of_a_truncated_report_is_none(tmp_path):
    report = tmp_path / "junit.xml"
    report.write_text("<testsuites><testsuite>", encoding="utf-8")
    assert mod.cases(report) == []


def test_verdict_green_run_is_green():
    assert mod.verdict(0, [mod.Case("t::a", "passed")]) == (0, [])


def test_verdict_keeps_pytests_red():
    code, lines = mod.verdict(1, [mod.Case("t::a", "passed"), mod.Case("t::b", "failed", "x")])
    assert code == 1
    # pytest printed this one's `FAILED` line itself.
    assert lines == []


def test_verdict_nothing_executed_is_red():
    code, lines = mod.verdict(0, [])
    assert code == 1
    assert "not a pass" in lines[-1]


def test_verdict_only_skips_is_red_and_names_each():
    code, lines = mod.verdict(0, [mod.Case("t::a", "skipped", "no minio\nsecond line")])
    assert code == 1
    assert lines[0] == "FAILED t::a - skipped: no minio"


def test_verdict_one_skip_in_a_green_run_is_red_without_the_scheduler():
    # Not gated on DEVKIT_E2E: this tier starts everything a test could want.
    code, lines = mod.verdict(0, [mod.Case("t::a", "passed"), mod.Case("t::b", "skipped")])
    assert code == 1
    assert lines[0] == "FAILED t::b - skipped: no reason"


def test_verdict_prints_a_setup_error_as_a_failed_line():
    code, lines = mod.verdict(1, [mod.Case("t::a", "passed"), mod.Case("t::b", "error", "boom")])
    assert code == 1
    assert lines == ["FAILED t::b - error: boom"]


def test_failure_line_quotes_the_last_line_of_the_output():
    line = mod.failure_line("up", "building\nport is already allocated\n")
    assert line == "FAILED scripts/e2e.py::up - port is already allocated"


def test_failure_line_with_no_output_still_signs_the_run():
    assert mod.failure_line("up", "") == "FAILED scripts/e2e.py::up - no output"


# --- running things ---


def test_run_returns_code_and_output(capsys):
    code, output = mod.run([sys.executable, "-c", "print('hello'); raise SystemExit(3)"], env=None)
    assert code == 3
    assert "hello" in output
    assert "hello" in capsys.readouterr().out


def test_run_can_keep_output_off_the_stream_the_pass_reads(capsys):
    code, output = mod.run([sys.executable, "-c", "print('FAILED x')"], env=None, echo=False)
    assert code == 0
    assert "FAILED x" in output
    assert "\nFAILED x" not in capsys.readouterr().out


def test_run_reports_a_missing_program_instead_of_raising():
    code, output = mod.run(["definitely-not-a-program-here"], env=None)
    assert code == 127
    assert "could not start" in output


def test_wait_until_returns_as_soon_as_it_is_true():
    assert mod.wait_until(lambda: True, timeout_s=0) is True


def test_wait_until_gives_up_when_the_budget_runs_out():
    assert mod.wait_until(lambda: False, timeout_s=0, interval_s=0) is False


def test_wait_until_polls_until_it_turns_true():
    results = iter([False, False, True])
    assert mod.wait_until(lambda: next(results), timeout_s=5, interval_s=0) is True


def test_answers_is_false_when_nothing_listens():
    assert mod.answers(f"http://{mod.LOOPBACK}:{mod.free_port()}/") is False


def test_answers_counts_an_error_status_as_an_answer(monkeypatch):
    def refuse(*_args, **_kwargs):
        raise mod.urllib.error.HTTPError("http://x", 500, "broken", None, None)

    monkeypatch.setattr(mod.urllib.request, "urlopen", refuse)
    assert mod.answers("http://x") is True


# --- the sequence ---


def scripted(monkeypatch, results):
    """Replace `mod.run` with one answering from `results`, recording each argv."""
    calls: list[list[str]] = []

    def fake(argv, env, *, echo=True):
        calls.append(list(argv))
        return results.pop(0) if results else (0, "")

    monkeypatch.setattr(mod, "run", fake)
    return calls


def test_start_stack_resets_then_ups_then_migrates(monkeypatch):
    calls = scripted(monkeypatch, [])
    assert mod.start_stack({}) is None
    assert calls == [mod.reset_argv(), mod.up_argv(), mod.buckets_argv(), mod.migrate_argv()]


def test_start_stack_stops_at_the_step_that_failed(monkeypatch):
    calls = scripted(monkeypatch, [(0, ""), (1, "port is already allocated")])
    failure = mod.start_stack({})
    assert failure == "FAILED scripts/e2e.py::up - port is already allocated"
    assert len(calls) == 2


def test_provision_bootstraps_then_installs_every_browser(monkeypatch):
    calls = scripted(monkeypatch, [])
    assert mod.provision({}) is None
    assert calls[0][1].endswith("bootstrap.py")
    assert calls[1][-len(mod.BROWSERS) :] == list(mod.BROWSERS)
    assert "playwright" in calls[1]


def test_provision_failure_names_its_step(monkeypatch):
    scripted(monkeypatch, [(1, "uv is required")])
    assert mod.provision({}) == "FAILED scripts/e2e.py::provision - uv is required"


def test_provision_names_a_browser_install_that_failed(monkeypatch):
    scripted(monkeypatch, [(0, ""), (1, "download failed")])
    assert mod.provision({}) == "FAILED scripts/e2e.py::browsers - download failed"


def test_start_vite_without_node_is_none(tmp_path, monkeypatch):
    monkeypatch.setattr(mod.shutil, "which", lambda *_args, **_kwargs: None)
    assert mod.start_vite({"PATH": ""}, PORTS, tmp_path / "vite.log") is None


def test_stop_vite_ends_the_process():
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    mod.stop_vite(proc)
    assert proc.poll() is not None


def test_stop_vite_kills_what_ignores_terminate():
    class Stubborn:
        def __init__(self):
            self.waits = 0
            self.killed = False

        def terminate(self):
            pass

        def kill(self):
            self.killed = True

        def wait(self, timeout):
            self.waits += 1
            if self.waits == 1:
                raise subprocess.TimeoutExpired("vite", timeout)

    proc = Stubborn()
    mod.stop_vite(proc)
    assert proc.killed


def test_keep_stack_log_writes_what_compose_printed(tmp_path, monkeypatch):
    echoes = []

    def fake(_argv, _env, *, echo=True):
        echoes.append(echo)
        return 0, "app-1 | started\n"

    monkeypatch.setattr(mod, "run", fake)
    (tmp_path / "logs").mkdir()
    mod.keep_stack_log({}, root=tmp_path)
    assert "app-1 | started" in (tmp_path / mod.STACK_LOG).read_text(encoding="utf-8")
    assert echoes == [False], "a `FAILED` in a container's log would sign the run"


class FakeVite:
    def __init__(self):
        self.terminated = False

    def terminate(self):
        self.terminated = True

    def wait(self, timeout):
        return 0


def tier_env():
    return mod.stack_env({"PATH": ""}, PORTS, "key")


def test_run_tier_without_node_is_a_named_failure(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(mod, "start_vite", lambda *_args: None)
    assert mod.run_tier(tier_env(), PORTS, tmp_path / "r.xml", ()) == 1
    assert "FAILED scripts/e2e.py::vite" in capsys.readouterr().out


def test_run_tier_stops_a_server_that_never_answered(tmp_path, monkeypatch, capsys):
    vite = FakeVite()
    monkeypatch.setattr(mod, "start_vite", lambda *_args: vite)
    monkeypatch.setattr(mod, "wait_until", lambda *_args, **_kwargs: False)
    assert mod.run_tier(tier_env(), PORTS, tmp_path / "r.xml", ()) == 1
    assert vite.terminated
    assert "never answered" in capsys.readouterr().out


def test_run_tier_reads_the_verdict_from_the_report(tmp_path, monkeypatch, capsys):
    vite = FakeVite()
    report = junit(tmp_path, '<testcase classname="tests.e2e.test_a" name="test_b" />')
    monkeypatch.setattr(mod, "start_vite", lambda *_args: vite)
    monkeypatch.setattr(mod, "wait_until", lambda *_args, **_kwargs: True)
    scripted(monkeypatch, [(0, "")])
    assert mod.run_tier(tier_env(), PORTS, report, ()) == 0
    assert vite.terminated


def test_run_tier_with_no_report_is_red(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(mod, "start_vite", lambda *_args: FakeVite())
    monkeypatch.setattr(mod, "wait_until", lambda *_args, **_kwargs: True)
    scripted(monkeypatch, [(0, "")])
    assert mod.run_tier(tier_env(), PORTS, tmp_path / "absent.xml", ()) == 1
    assert "not a pass" in capsys.readouterr().out


@pytest.fixture
def main_seams(tmp_path, monkeypatch):
    """`main` with nothing real behind it. Returns the calls it made, in order."""
    calls: list[str] = []
    monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(mod.node_runtime, "activate", lambda *_args: None)
    monkeypatch.setattr(mod, "provision", lambda _env: calls.append("provision"))
    monkeypatch.setattr(mod, "start_stack", lambda _env: calls.append("stack"))
    monkeypatch.setattr(mod, "keep_stack_log", lambda _env: calls.append("keep"))

    def fake_run(argv, _env):
        calls.append(" ".join(argv[-3:]))
        return 0, ""

    monkeypatch.setattr(mod, "run", fake_run)
    return calls


TEARDOWN = "down -v --remove-orphans"


def test_main_green_tears_down_and_keeps_no_stack_log(main_seams, monkeypatch, capsys):
    monkeypatch.setattr(mod, "run_tier", lambda *_args: main_seams.append("tier") or 0)
    assert mod.main([]) == 0
    assert main_seams == ["provision", "stack", "tier", TEARDOWN]
    assert "LOCAL E2E PASSED" in capsys.readouterr().out


def test_main_red_keeps_the_stack_log_before_the_teardown(main_seams, monkeypatch, capsys):
    monkeypatch.setattr(mod, "run_tier", lambda *_args: main_seams.append("tier") or 1)
    assert mod.main([]) == 1
    assert main_seams == ["provision", "stack", "tier", "keep", TEARDOWN]
    assert "LOCAL E2E FAILED" in capsys.readouterr().out


def test_main_a_stack_that_failed_still_tears_down(main_seams, monkeypatch, capsys):
    monkeypatch.setattr(mod, "start_stack", lambda _env: "FAILED scripts/e2e.py::up - x")
    monkeypatch.setattr(mod, "run_tier", lambda *_args: pytest.fail("ran on no stack"))
    assert mod.main([]) == 1
    assert main_seams == ["provision", "keep", TEARDOWN]
    assert "FAILED scripts/e2e.py::up - x" in capsys.readouterr().out


def test_main_a_tier_that_raised_still_tears_down(main_seams, monkeypatch):
    def boom(*_args):
        raise RuntimeError("interrupted")

    monkeypatch.setattr(mod, "run_tier", boom)
    with pytest.raises(RuntimeError):
        mod.main([])
    assert main_seams[-1] == TEARDOWN


def test_main_a_failed_provision_touches_no_stack(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(mod, "provision", lambda _env: "FAILED scripts/e2e.py::provision - x")
    monkeypatch.setattr(mod, "start_stack", lambda _env: pytest.fail("started a stack"))
    assert mod.main([]) == 1
    assert "FAILED scripts/e2e.py::provision - x" in capsys.readouterr().out


def test_main_passes_named_ids_to_the_tier(main_seams, monkeypatch):
    seen: list[list[str]] = []

    def tier(_env, _ports, _report, named):
        seen.append(named)
        return 0

    monkeypatch.setattr(mod, "run_tier", tier)
    assert mod.main(["tests/e2e/test_a.py::test_b"]) == 0
    assert seen == [["tests/e2e/test_a.py::test_b"]]


def test_main_clears_the_last_runs_report(main_seams, monkeypatch, tmp_path):
    stale = tmp_path / mod.JUNIT
    stale.parent.mkdir(parents=True)
    stale.write_text("yesterday", encoding="utf-8")
    monkeypatch.setattr(mod, "run_tier", lambda *_args: 0)
    mod.main([])
    assert not stale.exists()


def test_scripted_teardown_matches_the_real_argv():
    # `TEARDOWN` above is the tail of `reset_argv`, so the sequence tests follow it.
    assert shlex.join(mod.reset_argv()[-3:]) == TEARDOWN
