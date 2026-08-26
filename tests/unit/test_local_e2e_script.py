"""Unit coverage for the pure parts of ``scripts/local-e2e.py``.

The script itself can only be exercised for real on a machine running both sides of the
integration, so everything worth testing was factored out of ``main`` into functions that
take values and return values: env parsing, command planning, artifact rendering, exit
codes. These are that coverage.

Two properties matter more than the individual assertions and are pinned deliberately:

- **The dotenv parser agrees with the suite's.** The script cannot import
  ``tests/local_e2e/helpers`` (it must run before any test dependency exists), so the
  grammar is duplicated. A test comparing the two outputs is what stops the duplicate
  drifting into a config the script and pytest read differently.
- **A missing outbound driver is a skip, not a pass.** That distinction is the whole
  reason the driver step exists before the driver does.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "local-e2e.py"


def _load_script() -> Any:
    """Import ``scripts/local-e2e.py`` by path.

    The filename is not an identifier — the dash is deliberate, since every script in
    ``scripts/`` is spelled that way — so a plain ``import`` cannot reach it.

    The ``sys.modules`` registration before ``exec_module`` is load-bearing, not
    housekeeping: ``@dataclass`` resolves its annotations through
    ``sys.modules[cls.__module__].__dict__``, so a module executed without being
    registered raises ``AttributeError: 'NoneType' object has no attribute '__dict__'``
    at class-creation time — a failure that reads as a bug in the script rather than in
    the way the test imported it.
    """
    spec = importlib.util.spec_from_file_location("local_e2e_script", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


script = _load_script()


class TestParseDotenv:
    def test_reads_simple_pairs(self) -> None:
        assert script.parse_dotenv("A=1\nB=two\n") == {"A": "1", "B": "two"}

    def test_ignores_comments_and_blanks(self) -> None:
        assert script.parse_dotenv("# note\n\nA=1\n   \n") == {"A": "1"}

    def test_strips_surrounding_quotes(self) -> None:
        """Hand-written config quotes values inconsistently; both spellings must work."""
        assert script.parse_dotenv("A=\"x\"\nB='y'\n") == {"A": "x", "B": "y"}

    def test_keeps_windows_paths_intact(self) -> None:
        """``VS_REPO_DIR`` is a Windows path — backslashes are data, not escapes."""
        parsed = script.parse_dotenv(r"VS_REPO_DIR=C:\Users\me\LegacyCRM")
        assert parsed["VS_REPO_DIR"] == r"C:\Users\me\LegacyCRM"

    def test_keeps_equals_signs_inside_values(self) -> None:
        """Secrets are base64 and end in padding; splitting on every ``=`` truncates them."""
        assert script.parse_dotenv("S=abc==")["S"] == "abc=="

    def test_agrees_with_the_suite_loader(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The duplicated grammar must produce what ``helpers.load_dotenv`` produces.

        Different answers here mean the orchestrator and pytest read different configs,
        which surfaces as a suite that fails only when launched one of the two ways.
        """
        import os

        from tests.local_e2e import helpers

        text = '# c\nA=1\nB="two"\nVS_REPO_DIR=C:\\x\\y\nS=abc==\n'
        path = tmp_path / "probe.env"
        path.write_text(text, encoding="utf-8")
        for key in ("A", "B", "VS_REPO_DIR", "S"):
            monkeypatch.delenv(key, raising=False)

        helpers.load_dotenv(path)
        parsed = script.parse_dotenv(text)
        assert {key: os.environ[key] for key in parsed} == parsed


class TestResolveEnv:
    def test_real_environment_wins(self) -> None:
        """Same precedence as the suite: an inline override must not be ignored."""
        assert script.resolve_env({"A": "file"}, {"A": "real"})["A"] == "real"

    def test_file_supplies_what_the_environment_lacks(self) -> None:
        assert script.resolve_env({"A": "file"}, {"B": "real"}) == {"A": "file", "B": "real"}


class TestGate:
    def test_missing_file_names_the_example(self, tmp_path: Path) -> None:
        """The remedy has to be actionable — the reader needs the filename to copy."""
        reason = script.gate_reason(tmp_path / ".env.local-e2e", {})
        assert reason and ".env.local-e2e.example" in reason

    def test_flag_unset_is_gated(self, tmp_path: Path) -> None:
        env_file = tmp_path / ".env.local-e2e"
        env_file.write_text("A=1", encoding="utf-8")
        reason = script.gate_reason(env_file, {"RUN_LOCAL_E2E": "0"})
        assert reason and "RUN_LOCAL_E2E" in reason

    def test_configured_run_is_not_gated(self, tmp_path: Path) -> None:
        env_file = tmp_path / ".env.local-e2e"
        env_file.write_text("RUN_LOCAL_E2E=1", encoding="utf-8")
        assert script.gate_reason(env_file, {"RUN_LOCAL_E2E": "1"}) is None


class TestCommandPlanning:
    def test_health_url_tolerates_a_trailing_slash(self) -> None:
        assert script.health_url("http://localhost:8000/") == "http://localhost:8000/health"

    def test_powershell_command_uses_file_not_command(self) -> None:
        """``-Command`` swallows the script's exit code; the boot step would go green."""
        argv = script.powershell_command(Path("x.ps1"))
        assert "-File" in argv
        assert "-Command" not in argv
        assert "Bypass" in argv

    def test_vs_start_is_planned_when_the_script_exists(self, tmp_path: Path) -> None:
        start = tmp_path / script.VS_START_SCRIPT
        start.parent.mkdir(parents=True)
        start.write_text("# boot", encoding="utf-8")
        command, note = script.vs_start_command(str(tmp_path))
        assert command is not None
        assert command[-1] == str(start)
        assert note == str(start)

    def test_vs_start_without_repo_dir_names_the_key(self) -> None:
        command, note = script.vs_start_command(None)
        assert command is None
        assert "VS_REPO_DIR" in note

    def test_missing_driver_note_names_the_path(self, tmp_path: Path) -> None:
        """The skip has to say *which* file was absent, or it teaches nothing."""
        command, note = script.driver_command(str(tmp_path))
        assert command is None
        assert str(script.VS_DRIVER_SCRIPT) in note

    def test_driver_is_planned_once_it_exists(self, tmp_path: Path) -> None:
        run = tmp_path / script.VS_DRIVER_SCRIPT
        run.parent.mkdir(parents=True)
        run.write_text("# drive", encoding="utf-8")
        command, _ = script.driver_command(str(tmp_path))
        assert command is not None
        assert command[-1] == str(run)

    def test_pytest_command_prefers_the_repo_venv(self, tmp_path: Path) -> None:
        interpreter = script.venv_python(tmp_path)
        interpreter.parent.mkdir(parents=True)
        interpreter.write_text("", encoding="utf-8")
        command, warning = script.pytest_command(tmp_path)
        assert warning is None
        assert command[0] == str(interpreter)
        assert command[1:4] == ["-m", "pytest", script.SUITE]

    def test_pytest_command_falls_back_with_a_warning(self, tmp_path: Path) -> None:
        """Falling back silently would make an import error look like an integration bug."""
        import sys

        command, warning = script.pytest_command(tmp_path)
        assert command[0] == sys.executable
        assert warning and ".venv" in warning

    def test_extra_args_are_forwarded(self, tmp_path: Path) -> None:
        command, _ = script.pytest_command(tmp_path, ["-k", "vsapi"])
        assert command[-2:] == ["-k", "vsapi"]


class TestArtifact:
    def _results(self) -> list[Any]:
        return [
            script.StepResult("crm up", script.OK, exit_code=0),
            script.StepResult(
                "local_e2e suite", script.FAILED, exit_code=1, output="E   assert 400 == 204"
            ),
            script.StepResult("outbound driver", script.SKIPPED, detail="run.ps1 does not exist"),
        ]

    def test_summary_lists_every_step(self) -> None:
        text = script.render_artifact(self._results())
        for name in ("crm up", "local_e2e suite", "outbound driver"):
            assert name in text

    def test_failure_output_is_carried_into_the_file(self) -> None:
        """The point of the artifact: diagnose from the file, not from scrollback."""
        assert "assert 400 == 204" in script.render_artifact(self._results())

    def test_clean_run_still_produces_an_artifact(self) -> None:
        """A missing artifact reads as 'clean', so a green run must overwrite it too."""
        text = script.render_artifact([script.StepResult("suite", script.OK, exit_code=0)])
        assert "## summary" in text
        assert script.OK in text

    def test_gate_reason_is_recorded_rather_than_only_printed(self) -> None:
        text = script.render_artifact([], gate="RUN_LOCAL_E2E is not 1")
        assert "not started" in text
        assert "RUN_LOCAL_E2E is not 1" in text

    def test_write_creates_the_logs_directory(self, tmp_path: Path) -> None:
        target = tmp_path / "logs" / "local-e2e.log"
        script.write_artifact(target, "hello\n")
        assert target.read_text(encoding="utf-8") == "hello\n"

    def test_write_survives_non_ascii(self, tmp_path: Path) -> None:
        """Assertion messages carry en-dashes; a cp1252 default would raise after the run."""
        target = tmp_path / "logs" / "local-e2e.log"
        script.write_artifact(target, "rejected — 400\n")
        assert "—" in target.read_text(encoding="utf-8")


class TestExitCode:
    def test_all_ok_is_zero(self) -> None:
        assert script.overall_exit_code([script.StepResult("a", script.OK)]) == 0

    def test_a_skip_is_not_a_failure(self) -> None:
        """The driver is legitimately absent today; that must not redden the run."""
        results = [
            script.StepResult("a", script.OK),
            script.StepResult("outbound driver", script.SKIPPED),
        ]
        assert script.overall_exit_code(results) == 0

    def test_any_failure_is_nonzero(self) -> None:
        results = [script.StepResult("a", script.OK), script.StepResult("b", script.FAILED)]
        assert script.overall_exit_code(results) == 1

    def test_unconfigured_is_distinct_from_failed(self) -> None:
        """2 means 'go write .env.local-e2e'; 1 means 'go read the artifact'."""
        assert script.EXIT_UNCONFIGURED == 2


class TestSeed:
    """The step that gives the two field-contract tests a row to assert against."""

    def test_sql_never_interpolates_the_customer_id(self) -> None:
        """It is psql's ``:vsid``, which is what keeps the statement a constant.

        Interpolating it would be safe today — the caller coerces to ``int`` — and would
        still be the wrong shape: a query built by string concatenation is the pattern
        ``S608`` exists to stop, and suppressing the rule per-line teaches the next reader
        that this file is a place where that is fine.
        """
        sql = script.seed_sql()
        assert ":vsid" in sql
        assert "vs_customer_id = :vsid" in sql

    def test_sql_is_idempotent(self) -> None:
        """Re-running a green suite must not stack up duplicate rows."""
        sql = script.seed_sql()
        assert sql.count("WHERE NOT EXISTS") == 2

    def test_sql_touches_only_the_two_tables_it_claims(self) -> None:
        """A seed that grew a third insert would be doing something this name does not say."""
        inserts = [
            line for line in script.seed_sql().splitlines() if line.startswith("INSERT INTO")
        ]
        assert inserts == [
            "INSERT INTO extensions (customer_id, extension_number, sip_username, active)",
            "INSERT INTO phone_lines (customer_id, phone_number, provider_sid, active)",
        ]

    def test_seeded_rows_cannot_be_mistaken_for_provisioned_ones(self) -> None:
        """No ``sip_credential_sid``, and a ``provider_sid`` that names itself.

        The whole reason these rows are inserted directly is that the API routes that
        would create them buy a DID and provision a SIP endpoint against live provider
        credentials. A row that looked provisioned would invite someone to "clean it up"
        at the provider, where it does not exist.
        """
        sql = script.seed_sql()
        assert "sip_credential_sid" not in sql
        assert "local-e2e-synthetic" in sql
        assert "+15555550100" in sql  # the fictional 555-0100 block, not routable

    def test_command_binds_the_id_as_a_psql_variable(self) -> None:
        assert "-v vsid=7" in script.seed_command(7)[-1]

    def test_command_targets_no_project_by_default(self) -> None:
        """The static checkout's own compose project is the right answer there."""
        assert "-p" not in script.seed_command(1)

    def test_command_targets_a_named_project_when_given_one(self) -> None:
        """An ephemeral box has its own COMPOSE_PROJECT_NAME, so a bare `exec` misses.

        Without this the seed reports ``service "db" is not running`` from a box whose
        suite is happily testing the static checkout's stack over HTTP — the database it
        needs to seed belongs to a project this checkout has no default claim on.
        """
        command = script.seed_command(1, "carameli")
        assert command[:4] == ["docker", "compose", "-p", "carameli"]

    def test_skip_detail_names_the_knob_that_fixes_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A skip whose message does not say what to set is a silent coverage gap.

        This is the exact failure the step hit on its first real run from an ephemeral
        box: ``service "db" is not running``, two tests quietly skipped, and nothing in
        the artifact pointing at the setting that resolves it.
        """

        class _Proc:
            returncode = 1
            stdout = 'service "db" is not running\n'

        monkeypatch.setattr(script.subprocess, "run", lambda *a, **k: _Proc())
        result = script.seed_fixture_rows("1", {})
        assert result.status == script.SKIPPED
        assert "CARAMELI_COMPOSE_PROJECT" in result.detail
        assert 'service "db" is not running' in result.output

    def test_command_reads_credentials_from_the_container(self) -> None:
        """Never from a file here — that would be a second place for them to drift."""
        shell = script.seed_command(1)[-1]
        assert '-U "$POSTGRES_USER"' in shell
        assert '-d "$POSTGRES_DB"' in shell

    def test_unset_customer_id_skips_and_names_the_key(self) -> None:
        result = script.seed_fixture_rows(None, {})
        assert result.status == script.SKIPPED
        assert "CARAMELI_VS_CUSTOMER_ID" in result.detail

    def test_non_numeric_customer_id_fails_rather_than_reaching_the_shell(self) -> None:
        """A skip here would hide a typo in ``.env.local-e2e`` behind two skipped tests."""
        result = script.seed_fixture_rows("one; rm -rf /", {})
        assert result.status == script.FAILED
        assert "not a number" in result.detail

    def test_a_missing_db_service_is_a_skip_not_a_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Carameli may be remote, in which case there is no local database to seed."""

        def explode(*_args: Any, **_kwargs: Any) -> None:
            raise OSError("docker not found")

        monkeypatch.setattr(script.subprocess, "run", explode)
        result = script.seed_fixture_rows("1", {})
        assert result.status == script.SKIPPED
        assert "docker" in result.detail


class TestMainUnconfigured:
    """``main``'s one branch that runs on a machine with neither side installed.

    Everything past the gate shells out to LegacyCRM, Docker and pytest, so this is as
    far as a unit test can honestly go — but it is the branch almost every machine
    takes, and it is the one that must not be silent: the runners read a missing
    artifact as a clean run, so the unconfigured exit has to write one saying otherwise.
    """

    def _isolate(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
        artifact = tmp_path / "logs" / "local-e2e.log"
        monkeypatch.setattr(script, "ENV_FILE", tmp_path / ".env.local-e2e")
        monkeypatch.setattr(script, "ARTIFACT", artifact)
        return artifact

    def test_a_missing_env_file_exits_unconfigured(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._isolate(monkeypatch, tmp_path)
        assert script.main([]) == script.EXIT_UNCONFIGURED

    def test_the_gate_reaches_the_artifact(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        artifact = self._isolate(monkeypatch, tmp_path)
        script.main([])
        assert ".env.local-e2e not found" in artifact.read_text(encoding="utf-8")

    def test_a_configured_file_still_gates_on_the_opt_in(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """The file existing is not consent; ``RUN_LOCAL_E2E=1`` is."""
        artifact = self._isolate(monkeypatch, tmp_path)
        script.ENV_FILE.write_text("CARAMELI_BASE_URL=http://localhost:8000\n", encoding="utf-8")
        monkeypatch.delenv("RUN_LOCAL_E2E", raising=False)

        assert script.main([]) == script.EXIT_UNCONFIGURED
        assert "RUN_LOCAL_E2E is not 1" in artifact.read_text(encoding="utf-8")
