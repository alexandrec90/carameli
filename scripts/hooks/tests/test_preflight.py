"""Tests for scripts/preflight.py -- what stops a gate running, and what it says."""

import os

from conftest import REPO_ROOT, load_module

preflight = load_module("scripts/preflight.py")
failure_class = load_module("scripts/failure_class.py")
harness_config = load_module("scripts/hooks/harness_config.py")


def _cfg(*, frontend=True):
    return harness_config.Config(frontend=harness_config.FrontendConfig(enabled=frontend))


def _which(*present):
    return lambda name: f"/usr/bin/{name}" if name in present else None


# --- detection -------------------------------------------------------------


def test_missing_host_tools_reports_only_what_is_absent():
    absent = preflight.missing_host_tools(("ruff", "mypy"), which=_which("ruff"))
    assert absent == ["mypy"]


def test_a_provisioned_checkout_has_no_gaps(tmp_path):
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    assert preflight.gaps(tmp_path, _cfg(), which=_which(*preflight.HOST_TOOLS)) == []


def test_ci_is_not_reported_as_unprovisioned(tmp_path):
    # CI installs `uv pip install --system` into the runner's Python and never creates
    # a .venv. A directory probe would fail every CI lint run; `which` is the question
    # that actually matters -- can the tools be invoked.
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    assert not (tmp_path / ".venv").exists()
    assert preflight.gaps(tmp_path, _cfg(), which=_which(*preflight.HOST_TOOLS)) == []


def test_a_fresh_worktree_reports_both_tiers(tmp_path):
    (tmp_path / "frontend").mkdir()
    found = preflight.gaps(tmp_path, _cfg(), which=_which())

    assert len(found) == 2
    assert "ruff" in found[0]
    assert "frontend/node_modules" in found[1]


def test_a_checkout_with_no_frontend_is_not_told_to_install_one(tmp_path):
    # The app image carries no frontend/ tree.
    found = preflight.gaps(tmp_path, _cfg(), which=_which(*preflight.HOST_TOOLS))
    assert found == []


def test_the_frontend_tier_can_be_switched_off(tmp_path):
    (tmp_path / "frontend").mkdir()
    found = preflight.gaps(tmp_path, _cfg(frontend=False), which=_which(*preflight.HOST_TOOLS))
    assert found == []


def test_missing_frontend_names_the_directory_to_install(tmp_path):
    (tmp_path / "frontend").mkdir()
    assert preflight.missing_frontend(tmp_path, _cfg()) == "frontend"


def test_missing_frontend_is_silent_once_node_modules_is_there(tmp_path):
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    assert preflight.missing_frontend(tmp_path, _cfg()) == ""


def test_missing_frontend_is_silent_where_there_is_no_frontend(tmp_path):
    assert preflight.missing_frontend(tmp_path, _cfg()) == ""
    (tmp_path / "frontend").mkdir()
    assert preflight.missing_frontend(tmp_path, _cfg(frontend=False)) == ""


# --- wording ---------------------------------------------------------------


def test_gap_lines_are_not_reclassified_as_environmental_skips(tmp_path):
    # `failure_class.get_skip_reason` turns any line saying "not installed" / "command
    # not found" / "Cannot find" into a skip, and a skip is reported as a pass. These
    # lines are the one loud finding of the run, so none of them may match it.
    (tmp_path / "frontend").mkdir()
    found = preflight.gaps(tmp_path, _cfg(), which=_which())

    assert failure_class.get_skip_reason(found) is None


def test_the_tools_installed_out_of_band_are_not_required():
    # dotenv-linter and actionlint are curl-installed binaries; a desktop legitimately
    # lacks them and their runners already handle that. Requiring them here would block
    # every such machine from linting at all.
    assert "dotenv-linter" not in preflight.HOST_TOOLS
    assert "actionlint" not in preflight.HOST_TOOLS


# --- the fix command -------------------------------------------------------


def test_the_fix_command_is_the_one_the_manifest_names():
    # One string, in .devkit.toml, read by the SessionStart report, ship.py --preflight
    # and the runners -- so they cannot name three different commands.
    assert preflight.provisioning_command(REPO_ROOT) == "python scripts/bootstrap.py"


def test_this_repos_manifest_names_a_command_that_exists():
    command = preflight.provisioning_command(REPO_ROOT)
    script = command.split()[-1]
    assert (REPO_ROOT / script).is_file()


# --- the refusal -----------------------------------------------------------


def test_report_fails_and_writes_the_gaps_to_the_artifact(tmp_path):
    artifact = tmp_path / "logs" / "lint-errors.log"
    found = ["the Python lint toolchain is not on PATH here: ruff"]

    code = preflight.report("LINT", artifact, "scripts/lint-all.py (local)", found, "fix-me")

    # A refusal, not a skip: the checkout could not be checked.
    assert code == 1
    text = artifact.read_text(encoding="utf-8")
    assert "# source: scripts/lint-all.py (local)" in text
    assert "# fix: fix-me" in text
    assert found[0] in text


def test_artifact_text_survives_an_empty_fix():
    text = preflight.artifact_text("src", ["a gap"], "")
    assert "# fix:" not in text
    assert "a gap" in text


# --- putting the venv on PATH ----------------------------------------------


def test_ensure_venv_on_path_prepends_the_local_venv(tmp_path):
    (tmp_path / ".venv" / "Scripts").mkdir(parents=True)
    env = {"PATH": "/existing"}

    preflight.ensure_venv_on_path(tmp_path, env)

    assert env["PATH"].split(os.pathsep)[0] == str(tmp_path / ".venv" / "Scripts")


def test_ensure_venv_on_path_leaves_an_active_venv_alone(tmp_path):
    (tmp_path / ".venv" / "Scripts").mkdir(parents=True)
    env = {"PATH": "/existing", "VIRTUAL_ENV": "/somewhere/else"}

    preflight.ensure_venv_on_path(tmp_path, env)

    assert env["PATH"] == "/existing"


def test_ensure_venv_on_path_is_a_no_op_without_one(tmp_path):
    env = {"PATH": "/existing"}
    preflight.ensure_venv_on_path(tmp_path, env)
    assert env["PATH"] == "/existing"
