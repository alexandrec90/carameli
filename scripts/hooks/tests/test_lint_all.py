"""Tests for scripts/lint-all.py tool-set composition (local vs CI)."""
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
