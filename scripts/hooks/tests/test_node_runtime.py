"""Tests for scripts/node_runtime.py -- provisioning `.nvmrc`'s Node instead of reporting it."""

import hashlib
import io
import os
import zipfile
from types import SimpleNamespace

import pytest
from conftest import REPO_ROOT, load_module

node_runtime = load_module("scripts/node_runtime.py")

SHASUMS = (
    "aaa  node-v24.21.0-darwin-arm64.tar.gz\n"
    "bbb  node-v24.21.0-linux-x64.tar.xz\n"
    "ccc  node-v24.21.0-win-x64.zip\n"
    "ddd  node-v24.21.0-win-x64.7z\n"
    "eee  node-v24.21.0.tar.gz\n"
)


def _pin(root, line="24"):
    (root / ".nvmrc").write_text(f"{line}\n", encoding="utf-8")


def _fake_build(base, name, system):
    install = base / name
    directory = node_runtime.bin_dir(install, system)
    directory.mkdir(parents=True)
    (directory / node_runtime.node_exe_name(system)).write_text("", encoding="utf-8")
    return install


# --- the pin ---------------------------------------------------------------


def test_major_of_reduces_every_spelling_to_the_major():
    assert node_runtime.major_of("24") == "24"
    assert node_runtime.major_of("v24.8.1\n") == "24"
    assert node_runtime.major_of("lts/iron") == ""


def test_pinned_major_reads_nvmrc_and_is_empty_without_one(tmp_path):
    assert node_runtime.pinned_major(tmp_path) == ""
    _pin(tmp_path, "v31.2.0")
    assert node_runtime.pinned_major(tmp_path) == "31"


def test_this_repo_pins_a_readable_major():
    assert node_runtime.pinned_major(REPO_ROOT).isdigit()


# --- which build -----------------------------------------------------------


@pytest.mark.parametrize(
    ("system", "machine", "suffix"),
    [
        ("win32", "AMD64", "win-x64.zip"),
        ("linux", "x86_64", "linux-x64.tar.xz"),
        ("linux", "aarch64", "linux-arm64.tar.xz"),
        ("darwin", "arm64", "darwin-arm64.tar.gz"),
    ],
)
def test_asset_suffix_names_the_published_build(system, machine, suffix):
    assert node_runtime.asset_suffix(system, machine) == suffix


def test_asset_suffix_refuses_rather_than_guessing():
    with pytest.raises(ValueError, match="machine"):
        node_runtime.asset_suffix("linux", "riscv64")
    with pytest.raises(ValueError, match="platform"):
        node_runtime.asset_suffix("sunos5", "x86_64")


def test_pick_asset_takes_the_exact_build_and_its_digest():
    # The `.7z` sibling shares the prefix; only the exact suffix may match.
    assert node_runtime.pick_asset(SHASUMS, "win-x64.zip") == ("node-v24.21.0-win-x64.zip", "ccc")


def test_pick_asset_raises_when_the_release_has_no_such_build():
    with pytest.raises(ValueError, match=r"win-arm64\.zip"):
        node_runtime.pick_asset(SHASUMS, "win-arm64.zip")


# --- the cache -------------------------------------------------------------


def test_cache_root_is_per_user_and_outside_the_checkout(tmp_path):
    win = node_runtime.cache_root({"LOCALAPPDATA": str(tmp_path)}, "win32")
    assert win == tmp_path / "carameli" / "node"
    xdg = node_runtime.cache_root({"XDG_CACHE_HOME": str(tmp_path)}, "linux")
    assert xdg == tmp_path / "carameli" / "node"
    assert REPO_ROOT not in node_runtime.cache_root({}, "linux").parents


def test_cached_install_picks_the_newest_complete_build_of_the_major(tmp_path):
    _fake_build(tmp_path, "node-v24.2.0-linux-x64", "linux")
    newest = _fake_build(tmp_path, "node-v24.21.0-linux-x64", "linux")
    _fake_build(tmp_path, "node-v22.9.0-linux-x64", "linux")
    (tmp_path / "node-v24.99.0-linux-x64").mkdir()  # half-extracted: no node in it

    assert node_runtime.cached_install("24", tmp_path, "linux") == newest
    assert node_runtime.cached_install("26", tmp_path, "linux") is None


def test_path_node_major_reads_the_node_path_resolves(monkeypatch):
    monkeypatch.setattr(node_runtime.shutil, "which", lambda name, path=None: "/bin/node")
    monkeypatch.setattr(
        node_runtime.subprocess,
        "run",
        lambda argv, **kw: SimpleNamespace(stdout="v18.15.0\n", returncode=0),
    )
    assert node_runtime.path_node_major("anything") == "18"


def test_path_node_major_is_empty_without_a_node(monkeypatch):
    monkeypatch.setattr(node_runtime.shutil, "which", lambda name, path=None: None)
    assert node_runtime.path_node_major("") == ""


def test_path_node_major_is_empty_when_node_cannot_start(monkeypatch):
    def refuse(argv, **kw):
        raise OSError("not executable")

    monkeypatch.setattr(node_runtime.shutil, "which", lambda name, path=None: "/bin/node")
    monkeypatch.setattr(node_runtime.subprocess, "run", refuse)
    assert node_runtime.path_node_major("") == ""


# --- activate --------------------------------------------------------------


def test_activate_prepends_the_cached_build_when_path_has_the_wrong_major(tmp_path, monkeypatch):
    _pin(tmp_path)
    build = _fake_build(tmp_path / "cache", "node-v24.21.0-x", node_runtime.sys.platform)
    monkeypatch.setattr(node_runtime, "path_node_major", lambda path=None: "18")
    monkeypatch.setattr(node_runtime, "cached_install", lambda major: build)
    env = {"PATH": "system"}

    added = node_runtime.activate(tmp_path, env)

    assert added == node_runtime.bin_dir(build)
    assert env["PATH"].split(os.pathsep) == [str(added), "system"]


def test_activate_leaves_a_matching_path_alone(tmp_path, monkeypatch):
    # CI's setup-node already matches; nothing may be prepended there.
    _pin(tmp_path)
    monkeypatch.setattr(node_runtime, "path_node_major", lambda path=None: "24")
    env = {"PATH": "system"}

    assert node_runtime.activate(tmp_path, env) is None
    assert env == {"PATH": "system"}


def test_activate_without_a_cached_build_changes_nothing(tmp_path, monkeypatch):
    # Nothing to put first: preflight reports the mismatch and names bootstrap.
    _pin(tmp_path)
    monkeypatch.setattr(node_runtime, "path_node_major", lambda path=None: "18")
    monkeypatch.setattr(node_runtime, "cached_install", lambda major: None)
    env = {"PATH": "system"}

    assert node_runtime.activate(tmp_path, env) is None
    assert env == {"PATH": "system"}


# --- provision -------------------------------------------------------------


def _zip_of(top):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(f"{top}/node.exe", "")
    return buffer.getvalue()


def _provision_env(tmp_path, monkeypatch, payload, digest):
    _pin(tmp_path)
    cache = tmp_path / "cache"
    monkeypatch.setattr(node_runtime, "path_node_major", lambda path=None: "18")
    monkeypatch.setattr(node_runtime, "cache_root", lambda env=None, system=None: cache)
    monkeypatch.setattr(node_runtime, "asset_suffix", lambda: "win-x64.zip")
    monkeypatch.setattr(node_runtime.sys, "platform", "win32")
    urls = []
    shasums = f"{digest}  node-v24.21.0-win-x64.zip\n".encode()

    def fetch(url):
        urls.append(url)
        return shasums if url.endswith("SHASUMS256.txt") else payload

    return cache, urls, fetch


def test_provision_downloads_verifies_and_caches_the_pinned_line(tmp_path, monkeypatch):
    payload = _zip_of("node-v24.21.0-win-x64")
    cache, urls, fetch = _provision_env(
        tmp_path, monkeypatch, payload, hashlib.sha256(payload).hexdigest()
    )

    assert node_runtime.provision(tmp_path, fetch=fetch) == 0

    assert urls == [
        "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt",
        "https://nodejs.org/dist/latest-v24.x/node-v24.21.0-win-x64.zip",
    ]
    assert (cache / "node-v24.21.0-win-x64" / "node.exe").is_file()
    # Idempotent: a second run finds the cache and fetches nothing.
    assert node_runtime.provision(tmp_path, fetch=fetch) == 0
    assert len(urls) == 2


def test_provision_refuses_a_build_that_fails_its_checksum(tmp_path, monkeypatch):
    cache, _, fetch = _provision_env(tmp_path, monkeypatch, _zip_of("node-v24.21.0-win-x64"), "0")

    assert node_runtime.provision(tmp_path, fetch=fetch) == 1
    assert not (cache / "node-v24.21.0-win-x64").exists()


def test_provision_fetches_nothing_when_path_already_matches(tmp_path, monkeypatch):
    _pin(tmp_path)
    monkeypatch.setattr(node_runtime, "path_node_major", lambda path=None: "24")

    def fetch(url):
        raise AssertionError(f"fetched {url}")

    assert node_runtime.provision(tmp_path, fetch=fetch) == 0


def test_provision_is_a_no_op_for_a_repo_without_a_pin(tmp_path):
    assert node_runtime.provision(tmp_path, fetch=lambda url: b"") == 0
