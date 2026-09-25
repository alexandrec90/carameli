"""Tests for scripts/preflight.py -- what stops a gate running, and what it says."""

import os
from types import SimpleNamespace

import pytest
from conftest import REPO_ROOT, load_module

preflight = load_module("scripts/preflight.py")
failure_class = load_module("scripts/failure_class.py")
harness_config = load_module("scripts/hooks/harness_config.py")


@pytest.fixture(autouse=True)
def _no_real_node_activation(monkeypatch):
    """`gaps` puts the provisioned Node on this process's PATH; tests must not."""
    calls = []
    monkeypatch.setattr(preflight.node_runtime, "activate", lambda root: calls.append(root))
    return calls


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


# --- the Node pin ----------------------------------------------------------


def _node(version):
    """A `subprocess.run` stand-in that reports `version` from `node --version`."""

    def run(argv, **kwargs):
        assert argv == ["node", "--version"]
        return SimpleNamespace(stdout=version, returncode=0)

    return run


def _pinned(root, line):
    (root / "frontend" / "node_modules").mkdir(parents=True, exist_ok=True)
    (root / ".nvmrc").write_text(f"{line}\n", encoding="utf-8")


def test_node_major_reduces_every_spelling():
    assert preflight.node_major("v24.8.1") == "24"
    assert preflight.node_major("24.8.1") == "24"
    assert preflight.node_major("24") == "24"
    assert preflight.node_major("") == ""
    assert preflight.node_major("not a version") == ""


def test_node_gap_is_the_pure_core_of_the_check():
    """`node_mismatch` only adds the tier guards and the two probes; every wording
    decision is here, so this is where the four cases are pinned down."""
    assert preflight.node_gap("", "v20.20.2", present=True) == ""
    assert preflight.node_gap("24", "v24.21.0", present=True) == ""
    assert "not on PATH" in preflight.node_gap("24", "", present=False)
    assert "answers no version" in preflight.node_gap("24", "", present=True)
    assert ".nvmrc pins 24" in preflight.node_gap("24", "v20.20.2", present=True)


def test_a_matching_node_is_silent(tmp_path):
    _pinned(tmp_path, "24")
    found = preflight.gaps(
        tmp_path, _cfg(), which=_which(*preflight.HOST_TOOLS, "node"), run=_node("v24.8.1\n")
    )
    assert found == []


def test_a_newer_patch_on_the_pinned_line_is_not_a_mismatch(tmp_path):
    """`.nvmrc` names a release line, and setup-node resolves it to that line's newest
    patch. Comparing anything but the major reports every machine a fortnight behind."""
    _pinned(tmp_path, "24")
    assert (
        preflight.node_mismatch(tmp_path, _cfg(), which=_which("node"), run=_node("v24.99.0")) == ""
    )


def test_a_mismatched_node_names_both_versions_and_the_fix(tmp_path):
    _pinned(tmp_path, "24")
    line = preflight.node_mismatch(tmp_path, _cfg(), which=_which("node"), run=_node("v20.20.2"))

    assert "v20.20.2" in line
    assert ".nvmrc pins 24" in line
    assert "python scripts/bootstrap.py" in line


def test_an_absent_node_is_reported_with_the_same_fix(tmp_path):
    _pinned(tmp_path, "24")
    line = preflight.node_mismatch(tmp_path, _cfg(), which=_which(), run=_node(""))

    assert "not on PATH" in line
    assert "python scripts/bootstrap.py" in line


def test_a_node_that_answers_no_version_is_the_uninstalled_pin(tmp_path):
    """The shape this actually takes on Windows: nvm reads `.nvmrc` itself, finds the
    line absent, and says so on stderr -- so stdout is empty while `node` is on PATH.
    Reported as the uninstalled pin it is, not as a missing binary."""
    _pinned(tmp_path, "24")
    line = preflight.node_mismatch(tmp_path, _cfg(), which=_which("node"), run=_node(""))

    assert "answers no version" in line
    assert "python scripts/bootstrap.py" in line
    assert "not on PATH" not in line


def test_nvms_own_words_never_reach_the_gap_line(tmp_path):
    """nvm-windows answers "Node.js v24.x.x is not installed or cannot be found." --
    three phrases `_MISSING_TOOL` matches. Carried into the line, it would turn the
    run's one loud finding into a skip, and a skip is reported as a pass."""
    _pinned(tmp_path, "24")

    def stderr_only(argv, **kwargs):
        return SimpleNamespace(
            stdout="", stderr="Node.js v24.x.x is not installed or cannot be found.", returncode=1
        )

    line = preflight.node_mismatch(tmp_path, _cfg(), which=_which("node"), run=stderr_only)

    assert line
    assert failure_class.get_skip_reason([line]) is None


def test_the_fix_never_hard_codes_a_version(tmp_path):
    """The whole point of reading `.nvmrc`: moving the pin must not mean editing this
    module. A literal here would keep telling everyone to install the old line."""
    _pinned(tmp_path, "31")
    line = preflight.node_mismatch(tmp_path, _cfg(), which=_which("node"), run=_node("v24.8.1"))

    assert "python scripts/bootstrap.py" in line
    assert "31" in line
    assert "24" not in line.replace("v24.8.1", "")


def test_a_repo_that_pins_no_node_has_nothing_to_say(tmp_path):
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    assert not (tmp_path / ".nvmrc").exists()
    assert (
        preflight.node_mismatch(tmp_path, _cfg(), which=_which("node"), run=_node("v20.20.2")) == ""
    )


def test_the_node_check_is_skipped_wherever_the_frontend_tier_is(tmp_path):
    # Same two conditions as missing_frontend: the app image carries no frontend/, and
    # a project can switch the tier off. Neither has a Node gate to run.
    _pinned(tmp_path, "24")
    wrong = {"which": _which("node"), "run": _node("v20.20.2")}
    assert preflight.node_mismatch(tmp_path, _cfg(frontend=False), **wrong) == ""

    bare = tmp_path / "no-frontend"
    bare.mkdir()
    (bare / ".nvmrc").write_text("24\n", encoding="utf-8")
    assert preflight.node_mismatch(bare, _cfg(), **wrong) == ""


def test_the_repo_pin_is_what_this_reads():
    assert preflight.pinned_node(REPO_ROOT) == (REPO_ROOT / ".nvmrc").read_text("utf-8").strip()


def test_running_node_is_silent_rather_than_raising_when_node_cannot_be_run():
    """A node on PATH that will not execute is not a pin mismatch to shout about; the
    frontend tools will report their own failure with more to say than this can."""

    def explode(argv, **kwargs):
        raise OSError("bad exe")

    assert preflight.running_node(which=_which("node"), run=explode) == ""


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


def test_gaps_activates_the_provisioned_node_before_judging_it(tmp_path, _no_real_node_activation):
    # lint-all's only pre-run call: without this the check, and every npm step after
    # it, would judge the machine's own Node rather than the one bootstrap fetched.
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    preflight.gaps(tmp_path, _cfg(), which=_which(*preflight.HOST_TOOLS))

    assert _no_real_node_activation == [tmp_path]
