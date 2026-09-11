"""Tests for scripts/bootstrap.py -- the one command that provisions a checkout."""

import subprocess
import sys

import pytest
from conftest import REPO_ROOT, load_module

bootstrap = load_module("scripts/bootstrap.py")
harness_config = load_module("scripts/hooks/harness_config.py")


# --- the interpreter pin ---------------------------------------------------
# The whole point of this script over `python -m venv`: the venv has to be built on
# the version the image runs, and that version is read from the file that enforces it.


def test_image_python_version_reads_the_from_tag():
    dockerfile = "# comment\nFROM python:3.12-slim AS builder\nRUN pip install uv\n"
    assert bootstrap.image_python_version(dockerfile) == "3.12"


def test_image_python_version_takes_the_first_stage_and_drops_the_variant():
    dockerfile = "FROM python:3.12.7-slim AS builder\nFROM python:3.13-alpine AS base\n"
    assert bootstrap.image_python_version(dockerfile) == "3.12.7"


def test_image_python_version_raises_rather_than_defaulting():
    # A default here would be a second, silent pin -- the exact failure this replaces.
    with pytest.raises(ValueError, match="FROM python:"):
        bootstrap.image_python_version("FROM ubuntu:24.04\nRUN apt-get update\n")


def test_this_repos_dockerfile_still_carries_a_readable_pin():
    # Regression guard on the coupling itself: a Dockerfile rewritten to build its
    # interpreter another way leaves `create_venv` raising, and this says so here
    # rather than in a fresh worktree that cannot provision itself.
    text = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert bootstrap.image_python_version(text).startswith("3.")


# --- how uv is invoked -----------------------------------------------------


def test_uv_argv_prefers_the_executable_on_path():
    assert bootstrap.uv_argv(which=lambda name: "/usr/bin/uv" if name == "uv" else None) == ["uv"]


def test_uv_argv_falls_back_to_the_module_form(monkeypatch):
    # uv pip-installed into a Python whose Scripts/ is not on PATH -- the common
    # Windows shape. `python -m uv` still works there.
    monkeypatch.setattr(bootstrap.importlib.util, "find_spec", lambda name: object())
    assert bootstrap.uv_argv(which=lambda name: None) == [sys.executable, "-m", "uv"]


def test_uv_argv_is_none_when_uv_is_absent(monkeypatch):
    monkeypatch.setattr(bootstrap.importlib.util, "find_spec", lambda name: None)
    assert bootstrap.uv_argv(which=lambda name: None) is None


def test_venv_argv_pins_the_interpreter_and_seeds_pip(tmp_path):
    argv = bootstrap.venv_argv(["uv"], "3.12", tmp_path)

    assert argv[:2] == ["uv", "venv"]
    assert argv[argv.index("--python") + 1] == "3.12"
    # Without --seed the venv has no pip, and venv-install.py's uv bootstrap --
    # `python -m pip install uv==` -- dies in the one place that cannot recover.
    assert "--seed" in argv
    assert argv[-1] == str(tmp_path / ".venv")


# --- the frontend tier -----------------------------------------------------


def test_npm_argv_comes_from_the_vendored_ladder(tmp_path):
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "package-lock.json").write_text("{}", encoding="utf-8")

    argv = bootstrap.npm_argv(tmp_path, "frontend", which=lambda name: None)

    # `ci`, not `install`: `npm install` rewrites package-lock.json, which leaves a
    # worktree dirty before anything has been edited and ship.py then refuses it.
    assert argv == ["npm", "ci", "--prefix", "frontend"]


def test_npm_argv_resolves_the_launcher_to_a_real_path(tmp_path):
    (tmp_path / "frontend").mkdir()
    resolved = bootstrap.npm_argv(
        tmp_path, "frontend", which=lambda name: r"C:\node\npm.cmd" if name == "npm" else None
    )

    # A bare `npm` in a no-shell subprocess.run does not find the Windows shim.
    assert resolved[0] == r"C:\node\npm.cmd"
    assert resolved[1:] == ["install", "--prefix", "frontend"]


def test_install_frontend_is_a_no_op_when_node_modules_is_there(tmp_path, monkeypatch):
    (tmp_path / "frontend" / "node_modules").mkdir(parents=True)
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: pytest.fail("re-installed an installed tree")
    )
    cfg = harness_config.Config(frontend=harness_config.FrontendConfig(enabled=True))

    assert bootstrap.install_frontend(tmp_path, cfg) == 0


def test_install_frontend_skips_a_checkout_with_no_frontend(tmp_path, monkeypatch):
    # The app image is one: it carries no frontend/, and must not be told to install it.
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("installed nothing"))
    cfg = harness_config.Config(frontend=harness_config.FrontendConfig(enabled=True))

    assert bootstrap.install_frontend(tmp_path, cfg) == 0


def test_install_frontend_runs_npm_when_the_tree_is_missing(tmp_path, monkeypatch):
    (tmp_path / "frontend").mkdir()
    seen = []
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda argv, **k: seen.append(argv) or subprocess.CompletedProcess(argv, 0),
    )
    cfg = harness_config.Config(frontend=harness_config.FrontendConfig(enabled=True))

    assert bootstrap.install_frontend(tmp_path, cfg) == 0
    assert seen and seen[0][1:] == ["install", "--prefix", "frontend"]


# --- venv creation ---------------------------------------------------------


def test_create_venv_is_a_no_op_when_the_venv_is_there(tmp_path, monkeypatch):
    python = bootstrap.venv_python(tmp_path)
    python.parent.mkdir(parents=True)
    python.write_text("", encoding="utf-8")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("recreated a venv"))

    assert bootstrap.create_venv(tmp_path) == 0


def test_create_venv_fails_loudly_when_uv_is_absent(tmp_path, monkeypatch, capsys):
    # It must NOT quietly fall back to `python -m venv`: that produces a venv on the
    # machine default, which is the wrong-interpreter failure this exists to prevent.
    (tmp_path / "Dockerfile").write_text("FROM python:3.12-slim\n", encoding="utf-8")
    monkeypatch.setattr(bootstrap, "uv_argv", lambda: None)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("created a venv anyway"))

    assert bootstrap.create_venv(tmp_path) == 1
    assert "pip install uv" in capsys.readouterr().err


def test_create_venv_builds_on_the_pinned_interpreter(tmp_path, monkeypatch):
    (tmp_path / "Dockerfile").write_text("FROM python:3.12-slim AS builder\n", encoding="utf-8")
    monkeypatch.setattr(bootstrap, "uv_argv", lambda: ["uv"])
    seen = []
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda argv, **k: seen.append(argv) or subprocess.CompletedProcess(argv, 0),
    )

    assert bootstrap.create_venv(tmp_path) == 0
    assert seen[0][:2] == ["uv", "venv"]
    assert seen[0][seen[0].index("--python") + 1] == "3.12"


def test_install_python_delegates_to_the_one_install_owner(tmp_path, monkeypatch):
    # The pip/uv install lives in venv-install.py (and its VS Code task). Duplicating
    # it here would be a second opinion about how the dev lock gets installed.
    seen = []
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda argv, **k: seen.append(argv) or subprocess.CompletedProcess(argv, 0),
    )

    assert bootstrap.install_python(tmp_path) == 0
    assert seen[0][0] == sys.executable
    assert seen[0][1].endswith("venv-install.py")


def test_install_python_propagates_a_failed_install(tmp_path, monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda argv, **k: subprocess.CompletedProcess(argv, 2))
    assert bootstrap.install_python(tmp_path) == 2


# --- the whole run ---------------------------------------------------------


def test_main_stops_at_the_first_failing_step(monkeypatch):
    calls = []

    def step(name, code):
        def run(root):
            calls.append(name)
            return code

        return run

    monkeypatch.setattr(bootstrap, "create_venv", step("venv", 0))
    monkeypatch.setattr(bootstrap, "install_python", step("python", 3))
    monkeypatch.setattr(bootstrap, "install_frontend", step("frontend", 0))

    # The steps are read off the module at call time, so the patches above apply.
    assert bootstrap.main() == 3
    assert calls == ["venv", "python"]
