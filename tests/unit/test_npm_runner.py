"""`scripts/npm.py`: an npm command on the Node `.nvmrc` pins, not PATH's.

A session typed `npm run gen:phone-metadata` after `bootstrap.py`, as
`phoneMetadata.test.ts` told it to, and PATH's Node 18 died on `styleText`: the cached
pinned build is activated only inside `lint-all.py` and `run-tests.py`.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

npm = importlib.import_module("npm")


def _pin(tmp_path: Path, version: str = "24") -> Path:
    (tmp_path / ".nvmrc").write_text(version + "\n", encoding="utf-8")
    return tmp_path


def test_a_path_on_the_pinned_major_needs_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(npm.node_runtime, "path_node_major", lambda path: "24")
    assert npm.unpinned(_pin(tmp_path), {"PATH": "x"}) == ""


def test_a_path_on_another_major_names_bootstrap(tmp_path, monkeypatch):
    monkeypatch.setattr(npm.node_runtime, "path_node_major", lambda path: "18")
    said = npm.unpinned(_pin(tmp_path), {"PATH": "x"})
    assert "Node 24" in said and "scripts/bootstrap.py" in said


def test_no_pin_runs_whatever_path_has(tmp_path, monkeypatch):
    monkeypatch.setattr(npm.node_runtime, "path_node_major", lambda path: "18")
    assert npm.unpinned(tmp_path, {"PATH": "x"}) == ""


def test_npm_is_resolved_on_the_activated_path():
    """The `.cmd` shim is found on the PATH `activate` extended, not the process's."""
    seen: list[str | None] = []

    def which(name, path=None):
        seen.append(path)
        return r"C:\node24\npm.cmd"

    argv = npm.npm_argv(["run", "gen:phone-metadata"], {"PATH": r"C:\node24"}, which=which)
    assert argv == [r"C:\node24\npm.cmd", "run", "gen:phone-metadata"]
    assert seen == [r"C:\node24"]
    assert npm.npm_argv(["ci"], {}, which=lambda *a, **k: None) == ["npm", "ci"]


def test_main_runs_npm_in_the_frontend_on_the_activated_env(monkeypatch):
    ran: list[tuple[list[str], Path, str]] = []

    def activate(root, env):
        env["PATH"] = "pinned" + ";" + env.get("PATH", "")

    monkeypatch.setattr(npm.node_runtime, "activate", activate)
    monkeypatch.setattr(npm, "unpinned", lambda root, env: "")
    monkeypatch.setattr(npm.shutil, "which", lambda name, path=None: "npm")

    class Done:
        returncode = 3

    def run(argv, cwd, env):
        ran.append((argv, cwd, env["PATH"]))
        return Done()

    monkeypatch.setattr(npm.subprocess, "run", run)
    assert npm.main(["run", "gen:phone-metadata"]) == 3
    [(argv, cwd, path)] = ran
    assert argv == ["npm", "run", "gen:phone-metadata"]
    assert cwd == npm.REPO_ROOT / "frontend"
    assert path.startswith("pinned")


def test_main_refuses_without_the_pinned_node(monkeypatch, capsys):
    monkeypatch.setattr(npm.node_runtime, "activate", lambda root, env: None)
    monkeypatch.setattr(npm, "unpinned", lambda root, env: "npm: run bootstrap")
    monkeypatch.setattr(
        npm.subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError)
    )
    assert npm.main(["run", "x"]) == 2
    assert "bootstrap" in capsys.readouterr().err


def test_bare_and_help_print_the_usage(capsys):
    assert npm.main([]) == 2
    assert npm.main(["--help"]) == 0
    assert "scripts/npm.py" in capsys.readouterr().out
