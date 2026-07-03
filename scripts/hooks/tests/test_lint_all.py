"""Tests for scripts/lint-all.py tool-set composition (local vs CI) and the
--changed scoping mode."""

from conftest import load_module

la = load_module("scripts/lint-all.py")


def test_ci_excludes_local_only_tools():
    # detect-secrets mutates a committed baseline; dotenv-linter / lint-instructions
    # are enforced via pre-commit locally -- none should run in CI.
    for tool in (la.t_detect_secrets, la.t_dotenv, la.t_lint_instructions):
        assert tool in la.LOCAL_TOOLS
        assert tool not in la.CI_TOOLS


def test_core_linters_run_everywhere():
    for tool in (la.t_ruff, la.t_mypy, la.t_eslint, la.t_tsc, la.t_vulture, la.t_alembic_check):
        assert tool in la.LOCAL_TOOLS
        assert tool in la.CI_TOOLS


def test_every_ci_tool_is_also_local():
    assert set(la.CI_TOOLS).issubset(set(la.LOCAL_TOOLS))


# --- changed-files scoping -------------------------------------------------


def test_predicates_classify_paths():
    assert la._is_py("app/services/x.py")
    assert la._is_app_py("app/services/x.py")
    assert not la._is_app_py("tests/unit/test_x.py")  # py, but not under app/
    assert la._is_fe_script("frontend/src/App.tsx")
    assert not la._is_fe_script("frontend/src/styles.css")
    assert la._is_fe_css("frontend/src/styles.css")
    assert la._is_md("README.md")
    assert la._is_req("requirements-dev.txt")
    assert la._is_env(".env.example")
    assert la._is_migration("alembic/versions/abc.py")
    assert la._is_migration("app/models/call.py")
    assert la._is_yaml(".github/workflows/ci.yml")
    assert la._is_workflow(".github/workflows/ci.yml")
    assert la._is_instruction("CLAUDE.md")
    assert la._is_instruction(".claude/rules/security.md")
    assert not la._is_instruction("docs/guide.md")


def test_changed_files_explicit_paths_filters_to_existing_and_dedups():
    # CLAUDE.md exists at the repo root; the bogus path does not.
    got = la.changed_files(["CLAUDE.md", "CLAUDE.md", "does/not/exist.zzz"])
    assert got == ["CLAUDE.md"]


def test_changed_files_empty_when_nothing_given():
    assert la.changed_files([]) == []


def test_parse_args_modes():
    assert la._parse_args([]).changed is False
    assert la._parse_args([]).paths is None
    assert la._parse_args(["--changed"]).changed is True
    assert la._parse_args(["--paths", "a.py", "b.py"]).paths == ["a.py", "b.py"]


# Each tool short-circuits to a clean pass (no subprocess) when the changed set
# holds nothing it cares about. Passing an irrelevant diff verifies the gate
# without spawning the linter.
def test_host_tools_skip_when_no_relevant_change():
    fe_only = ["frontend/src/App.tsx"]
    assert la.t_ruff(fe_only) == {"ruff-check": ([], 0), "ruff-format": ([], 0)}
    assert la.t_mypy(fe_only) == {"mypy": ([], 0)}
    assert la.t_vulture(fe_only) == {"vulture": ([], 0)}


def test_gated_tools_skip_when_no_relevant_change():
    py_only = ["app/services/x.py"]
    assert la.t_eslint(py_only) == {"eslint": ([], 0)}
    assert la.t_tsc(py_only) == {"tsc": ([], 0)}
    assert la.t_stylelint(py_only) == {"stylelint": ([], 0)}
    assert la.t_markdownlint(py_only) == {"markdownlint": ([], 0)}
    assert la.t_pip_audit(py_only) == {"pip-audit": ([], 0)}
    assert la.t_alembic_check(py_only) == {"alembic-check": ([], 0)}
    assert la.t_yamllint(py_only) == {"yamllint": ([], 0)}
    assert la.t_actionlint(py_only) == {"actionlint": ([], 0)}
    assert la.t_lint_instructions(py_only) == {"lint-instructions": ([], 0)}
    assert la.t_dotenv(py_only) == {"dotenv-linter": ([], 0)}
    assert la.t_detect_secrets([".secrets.baseline"]) == {"detect-secrets": ([], 0)}


# The pip-audit gate triggers on both the compiled locks and the .in floor files.
def test_is_req_matches_lock_and_source_files():
    assert la._is_req("requirements.txt")
    assert la._is_req("requirements-dev.in")
    assert not la._is_req("requirements.md")
    assert not la._is_req("app/main.py")


# pip-audit is report-only: it must never `pip install` anything, even when the
# audit finds vulnerable packages. Unconstrained upgrades from a lint run drift
# the local venv from requirements/CI (see .claude/rules/diagnostics.md §4).
def test_pip_audit_reports_without_upgrading(monkeypatch):
    calls: list[str] = []

    def fake_run(cmd: str):
        calls.append(cmd)
        return (["requests 2.31.0 CVE-2099-0001 2.32.0"], 1)

    monkeypatch.setattr(la, "run", fake_run)
    out = la.t_pip_audit(None)
    assert out == {"pip-audit": (["requests 2.31.0 CVE-2099-0001 2.32.0"], 1)}
    assert calls == ["pip-audit --ignore-vuln CVE-2026-4539"]
    assert not any("install" in c for c in calls)


# --- alembic-check via a fresh throwaway database ---------------------------
# Locally the shared dev DB is schema-managed by the test suite (create_all, never
# alembic-stamped), so alembic-check must migrate a throwaway DB from scratch and
# check against that -- checking the shared DB reports state noise, not code drift.


def test_alembic_fresh_db_skips_cleanly_when_stack_down(monkeypatch, capsys):
    monkeypatch.setattr(la, "run", lambda cmd: ([], 1))
    assert la._alembic_check_fresh_db() == ([], 0)
    assert "[skip] alembic-check" in capsys.readouterr().out


def test_alembic_fresh_db_creates_migrates_checks_and_drops(monkeypatch):
    calls: list[str] = []

    def fake_run(cmd: str):
        calls.append(cmd)
        if "printenv" in cmd:
            return (["postgresql+asyncpg://u:p@db:5432/carameli"], 0)
        if "alembic check" in cmd:
            return (["No new upgrade operations detected."], 0)
        return ([], 0)

    monkeypatch.setattr(la, "run", fake_run)
    _, rc = la._alembic_check_fresh_db()
    assert rc == 0
    assert any("CREATE DATABASE carameli_lint_check" in c for c in calls)
    # upgrade + check both run against the throwaway DB, not the shared one
    assert any("alembic upgrade head" in c and "carameli_lint_check" in c for c in calls)
    assert any("alembic check" in c and "carameli_lint_check" in c for c in calls)
    # dropped up front (leftover from a crashed run) and again on the way out
    assert sum("DROP DATABASE IF EXISTS carameli_lint_check" in c for c in calls) == 2


def test_alembic_fresh_db_reports_broken_migrations(monkeypatch):
    def fake_run(cmd: str):
        if "printenv" in cmd:
            return (["postgresql+asyncpg://u:p@db:5432/carameli"], 0)
        if "alembic upgrade head" in cmd:
            return (["FAILED: boom in migration 007"], 1)
        return ([], 0)

    monkeypatch.setattr(la, "run", fake_run)
    out, rc = la._alembic_check_fresh_db()
    assert rc == 1
    assert out == ["FAILED: boom in migration 007"]


# --- detect-secrets: report only what actually changed the baseline ---------


def test_detect_secrets_silent_when_baseline_unchanged(monkeypatch, capsys):
    # `scan --update` runs but leaves the (real, existing) baseline byte-identical,
    # so nothing may be printed -- the old raw-rescan comparison cried wolf here.
    monkeypatch.setattr(la, "run", lambda cmd: ([], 0))
    assert la.t_detect_secrets(None) == {"detect-secrets": ([], 0)}
    assert "detect-secrets" not in capsys.readouterr().out


def test_detect_secrets_reports_new_findings_from_baseline_diff(monkeypatch, tmp_path, capsys):
    baseline = tmp_path / ".secrets.baseline"
    before = '{"results": {"a.py": [{"hashed_secret": "h1"}]}}'
    after = '{"results": {"a.py": [{"hashed_secret": "h1"}, {"hashed_secret": "h2"}]}}'
    baseline.write_text(before, encoding="utf-8")

    def fake_run(cmd: str):
        if "scan --baseline" in cmd:
            baseline.write_text(after, encoding="utf-8")
        return ([], 0)

    monkeypatch.setattr(la, "run", fake_run)
    monkeypatch.setattr(la, "REPO_ROOT", tmp_path)
    assert la.t_detect_secrets(None) == {"detect-secrets": ([], 0)}
    assert "1 new finding(s)" in capsys.readouterr().out


def test_detect_secrets_restores_timestamp_only_churn(monkeypatch, tmp_path, capsys):
    # detect-secrets rewrites `generated_at` on every `scan --baseline` run; when
    # that is the only change the runner must restore the file (git stays clean)
    # and report nothing.
    baseline = tmp_path / ".secrets.baseline"
    before = (
        '{"results": {"a.py": [{"hashed_secret": "h1"}]}, "generated_at": "2026-01-01T00:00:00Z"}'
    )
    after = (
        '{"results": {"a.py": [{"hashed_secret": "h1"}]}, "generated_at": "2026-07-01T12:00:00Z"}'
    )
    baseline.write_text(before, encoding="utf-8")

    def fake_run(cmd: str):
        if "scan --baseline" in cmd:
            baseline.write_text(after, encoding="utf-8")
        return ([], 0)

    monkeypatch.setattr(la, "run", fake_run)
    monkeypatch.setattr(la, "REPO_ROOT", tmp_path)
    assert la.t_detect_secrets(None) == {"detect-secrets": ([], 0)}
    assert baseline.read_text(encoding="utf-8") == before
    assert "detect-secrets" not in capsys.readouterr().out
