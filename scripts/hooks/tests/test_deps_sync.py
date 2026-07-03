"""Tests for scripts/hooks/deps-sync.py (lockfile-change -> local reinstall)."""

import json

from conftest import load_module

ds = load_module("scripts/hooks/deps-sync.py")


def _seed_manifests(root, lock=b"lock-v1", req=b"req-v1", dev=b"dev-v1"):
    (root / "frontend").mkdir(parents=True, exist_ok=True)
    (root / "frontend" / "package-lock.json").write_bytes(lock)
    (root / "requirements.txt").write_bytes(req)
    (root / "requirements-dev.txt").write_bytes(dev)
    (root / "requirements.in").write_bytes(b"req-in-v1")
    (root / "requirements-dev.in").write_bytes(b"dev-in-v1")
    (root / "Dockerfile").write_bytes(b"FROM python:3.12")
    (root / "docker-compose.yml").write_bytes(b"services: {}")
    (root / "docker-compose.override.yml").write_bytes(b"services: {}")


def test_fingerprint_tracks_content_and_omits_missing(tmp_path):
    _seed_manifests(tmp_path)
    first = ds.fingerprint(tmp_path)
    assert set(first) == set(ds.MANIFESTS)

    (tmp_path / "requirements.txt").write_bytes(b"req-v2")
    second = ds.fingerprint(tmp_path)
    assert second["requirements.txt"] != first["requirements.txt"]
    assert second["frontend/package-lock.json"] == first["frontend/package-lock.json"]

    (tmp_path / "requirements-dev.txt").unlink()
    assert "requirements-dev.txt" not in ds.fingerprint(tmp_path)


def test_changed_manifests_detects_diffs_and_new_files():
    recorded = {"requirements.txt": "aaa"}
    current = {"requirements.txt": "aaa", "frontend/package-lock.json": "bbb"}
    assert ds.changed_manifests(current, recorded) == ["frontend/package-lock.json"]
    assert ds.changed_manifests({"requirements.txt": "zzz"}, recorded) == ["requirements.txt"]
    assert ds.changed_manifests(recorded, recorded) == []


def test_plan_maps_manifests_to_installs(tmp_path, monkeypatch):
    monkeypatch.setattr(ds.shutil, "which", lambda _: "C:/npm.cmd")
    venv_py = tmp_path / "py.exe"

    pip_only = ds.plan(["requirements.txt"], tmp_path, venv_py)
    assert len(pip_only) == 1
    assert pip_only[0][1][:3] == [str(venv_py), "-m", "pip"]
    assert pip_only[0][2] == tmp_path

    npm_only = ds.plan(["frontend/package-lock.json"], tmp_path, venv_py)
    assert len(npm_only) == 1
    assert npm_only[0][1] == ["C:/npm.cmd", "install"]
    assert npm_only[0][2] == tmp_path / "frontend"

    both = ds.plan(["frontend/package-lock.json", "requirements-dev.txt"], tmp_path, venv_py)
    assert len(both) == 2


def test_docker_changes_notify_but_never_install(tmp_path, monkeypatch, capsys):
    # Dockerfile-only change: no install command is planned...
    assert ds.plan(["Dockerfile"], tmp_path, None) == []

    # ...and main() prints the staleness notice without running anything.
    _seed_manifests(tmp_path)
    state = tmp_path / ".git" / "deps-fingerprint.json"
    state.parent.mkdir()
    monkeypatch.setattr(ds, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", state)
    ds.main([])  # baseline
    monkeypatch.setattr(
        ds.subprocess,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not install")),
    )

    (tmp_path / "Dockerfile").write_bytes(b"FROM python:3.13")
    assert ds.main([]) == 0
    assert "container is now stale" in capsys.readouterr().out
    assert ds.main([]) == 0  # state re-recorded -> notice not repeated
    assert "container is now stale" not in capsys.readouterr().out


def test_in_only_change_prints_recompile_notice(tmp_path, monkeypatch, capsys):
    # .in floors edited without recompiling the .txt lock -> nudge, no install.
    _seed_manifests(tmp_path)
    state = tmp_path / ".git" / "deps-fingerprint.json"
    state.parent.mkdir()
    monkeypatch.setattr(ds, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", state)
    ds.main([])  # baseline
    monkeypatch.setattr(
        ds.subprocess,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not install")),
    )

    (tmp_path / "requirements.in").write_bytes(b"req-in-v2")
    assert ds.main([]) == 0
    assert "not recompiled" in capsys.readouterr().out


def test_requirements_change_installs_and_notifies_docker(tmp_path, monkeypatch, capsys):
    _seed_manifests(tmp_path)
    state = tmp_path / ".git" / "deps-fingerprint.json"
    state.parent.mkdir()
    monkeypatch.setattr(ds, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", state)
    ds.main([])  # baseline

    class Result:
        returncode = 0

    calls: list[list[str]] = []
    monkeypatch.setattr(ds.subprocess, "run", lambda argv, cwd: (calls.append(argv), Result())[1])

    (tmp_path / "requirements.txt").write_bytes(b"req-v2")
    assert ds.main([]) == 0
    out = capsys.readouterr().out
    assert len(calls) == 1 and "pip" in calls[0]  # venv reinstalled...
    assert "container is now stale" in out  # ...and the container flagged


def test_plan_skips_npm_when_not_on_path(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ds.shutil, "which", lambda _: None)
    assert ds.plan(["frontend/package-lock.json"], tmp_path, None) == []
    assert "npm not on PATH" in capsys.readouterr().err


def test_install_hooks_writes_shims_and_respects_foreign_hooks(tmp_path, capsys):
    written = ds.install_hooks(tmp_path)
    assert sorted(p.name for p in written) == sorted(ds.HOOK_NAMES)
    for name in ds.HOOK_NAMES:
        assert "deps-sync.py" in (tmp_path / name).read_text(encoding="utf-8")

    # Re-install over our own shim is fine; a foreign hook is left untouched.
    (tmp_path / "post-merge").write_text("#!/bin/sh\nsomething-else\n", encoding="utf-8")
    written = ds.install_hooks(tmp_path)
    assert sorted(p.name for p in written) == sorted(n for n in ds.HOOK_NAMES if n != "post-merge")
    assert "something-else" in (tmp_path / "post-merge").read_text(encoding="utf-8")
    assert "not ours" in capsys.readouterr().err


def test_main_records_baseline_without_installing(tmp_path, monkeypatch, capsys):
    _seed_manifests(tmp_path)
    state = tmp_path / ".git" / "deps-fingerprint.json"
    state.parent.mkdir()
    monkeypatch.setattr(ds, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", state)
    monkeypatch.setattr(
        ds.subprocess,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not install")),
    )

    assert ds.main([]) == 0
    assert "baseline recorded" in capsys.readouterr().out
    assert json.loads(state.read_text(encoding="utf-8")) == ds.fingerprint(tmp_path)


def test_main_installs_on_change_and_rerecords_only_on_success(tmp_path, monkeypatch):
    _seed_manifests(tmp_path)
    state = tmp_path / ".git" / "deps-fingerprint.json"
    state.parent.mkdir()
    monkeypatch.setattr(ds, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", state)
    ds.main([])  # baseline

    (tmp_path / "requirements.txt").write_bytes(b"req-v2")

    class Result:
        def __init__(self, returncode):
            self.returncode = returncode

    calls: list[list[str]] = []

    monkeypatch.setattr(ds.subprocess, "run", lambda argv, cwd: (calls.append(argv), Result(1))[1])
    assert ds.main([]) == 1  # failed install -> state not re-recorded
    assert len(calls) == 1 and "pip" in calls[0]
    assert ds.changed_manifests(
        ds.fingerprint(tmp_path), json.loads(state.read_text(encoding="utf-8"))
    )

    monkeypatch.setattr(ds.subprocess, "run", lambda argv, cwd: (calls.append(argv), Result(0))[1])
    assert ds.main([]) == 0  # retry succeeds -> state re-recorded, next run is a no-op
    assert json.loads(state.read_text(encoding="utf-8")) == ds.fingerprint(tmp_path)
    monkeypatch.setattr(
        ds.subprocess,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not install")),
    )
    assert ds.main([]) == 0
