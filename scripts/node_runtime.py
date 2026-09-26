#!/usr/bin/env python3
"""The Node the frontend gates run on: `.nvmrc`'s line, provisioned rather than hoped for.

`bootstrap.py` builds the venv on the pinned Python whatever the machine has, because
`uv` fetches the interpreter. Node had no equivalent: bootstrap ran `npm ci` on whatever
`node` was first on PATH, and `preflight.py` could only *say* the version was wrong and
suggest `nvm`, which the machine may not have. A workstation on Node 18 then refused
`npm ci` under `frontend/.npmrc`'s `engine-strict`, lint could not start, and the
session that met it could do nothing but report it. The pin moves whenever a dependency
raises its `engines.node` floor, so that was not a one-off either.

So this does for Node what `uv venv --python` does for Python:

- `provision()` (bootstrap's step) downloads the official build of the pinned line from
  nodejs.org when PATH's `node` is on another major, checks it against the release's
  published `SHASUMS256.txt`, and unpacks it into a per-user cache shared by every
  worktree. The system install is never touched.
- `activate()` (each runner's first act) puts that cached build first on this process's
  PATH, so every child -- `npm` through `shell=True`, `shutil.which`, the `.cmd` shims --
  resolves to it. On a machine or CI runner whose PATH Node already matches, it does
  nothing.

The version is read from `.nvmrc`, never written here. Stdlib only: this runs before
anything is installed. Pure functions are importable for tests; network and disk side
effects sit in `provision()`.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NODE_PIN_FILE = ".nvmrc"
DIST_URL = "https://nodejs.org/dist"


def pinned_major(root: Path = REPO_ROOT) -> str:
    """The major `.nvmrc` pins (`24`, `v24`, `24.8.1` -> `24`), or "" when there is none."""
    path = root / NODE_PIN_FILE
    if not path.exists():
        return ""
    return major_of(path.read_text(encoding="utf-8"))


def major_of(version: str) -> str:
    """`v24.8.1`, `24.8.1` and `24` all reduce to `24`; anything else to "". Pure."""
    match = re.match(r"v?(\d+)", version.strip())
    return match.group(1) if match else ""


def asset_suffix(system: str = sys.platform, machine: str = platform.machine()) -> str:
    """The release-asset suffix for this host, e.g. `win-x64.zip`. Pure.

    Raises on a host nodejs.org publishes no build for, rather than guessing one.
    """
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(
        machine.lower()
    )
    if arch is None:
        raise ValueError(f"no Node build is published for machine {machine!r}")
    if system.startswith("win"):
        return f"win-{arch}.zip"
    if system == "darwin":
        return f"darwin-{arch}.tar.gz"
    if system.startswith("linux"):
        return f"linux-{arch}.tar.xz"
    raise ValueError(f"no Node build is published for platform {system!r}")


def pick_asset(shasums: str, suffix: str) -> tuple[str, str]:
    """`(asset name, sha256)` for `suffix` in a release's `SHASUMS256.txt`. Pure."""
    for line in shasums.splitlines():
        parts = line.split()
        if len(parts) == 2 and re.fullmatch(rf"node-v[\d.]+-{re.escape(suffix)}", parts[1]):
            return parts[1], parts[0]
    raise ValueError(f"the release lists no `{suffix}` build")


def cache_root(env: dict[str, str] | None = None, system: str | None = None) -> Path:
    """Where provisioned builds live: per user, shared by every worktree. Pure.

    Outside the checkout on purpose -- a fresh worktree must not download it again,
    and `git clean` must not delete the runtime every other worktree is using.
    """
    env = dict(os.environ) if env is None else env
    system = sys.platform if system is None else system
    if system.startswith("win") and env.get("LOCALAPPDATA"):
        base = Path(env["LOCALAPPDATA"])
    elif env.get("XDG_CACHE_HOME"):
        base = Path(env["XDG_CACHE_HOME"])
    else:
        base = Path.home() / ".cache"
    return base / "carameli" / "node"


def bin_dir(install: Path, system: str | None = None) -> Path:
    """The directory holding `node` and `npm` inside an unpacked build. Pure."""
    system = sys.platform if system is None else system
    return install if system.startswith("win") else install / "bin"


def node_exe_name(system: str | None = None) -> str:
    system = sys.platform if system is None else system
    return "node.exe" if system.startswith("win") else "node"


def cached_install(major: str, root: Path | None = None, system: str | None = None) -> Path | None:
    """The newest cached build of `major` that holds a `node`, or None.

    `system` defaults to `sys.platform` as it is at call time, not at import: a
    default bound once answers for the host even where the caller has said otherwise.
    """
    system = sys.platform if system is None else system
    base = cache_root(system=system) if root is None else root
    if not major or not base.is_dir():
        return None
    candidates = [
        entry
        for entry in base.iterdir()
        if entry.is_dir()
        and major_of(entry.name.removeprefix("node-")) == major
        and (bin_dir(entry, system) / node_exe_name(system)).is_file()
    ]
    if not candidates:
        return None

    def version_key(entry: Path) -> tuple[int, ...]:
        found = re.match(r"node-v([\d.]+)", entry.name)
        return tuple(int(n) for n in found.group(1).split(".")) if found else ()

    return max(candidates, key=version_key)


def path_node_major(path: str | None = None) -> str:
    """The major of the `node` that `path` resolves, or "" when there is none."""
    node = shutil.which("node", path=path)
    if not node:
        return ""
    try:
        done = subprocess.run(
            [node, "--version"], capture_output=True, text=True, timeout=30, check=False
        )
    except OSError:
        return ""
    return major_of(done.stdout or "")


def activate(root: Path = REPO_ROOT, env: dict[str, str] | None = None) -> Path | None:
    """Put the provisioned build first on PATH when PATH's own `node` is the wrong line.

    Mutates `env` (default: `os.environ`) so every child process inherits it. Returns
    the directory it prepended, or None when nothing was needed or nothing is cached --
    in which case `preflight` reports the mismatch and names bootstrap.
    """
    env = os.environ if env is None else env
    major = pinned_major(root)
    if not major or path_node_major(env.get("PATH")) == major:
        return None
    install = cached_install(major)
    if install is None:
        return None
    directory = bin_dir(install)
    env["PATH"] = os.pathsep.join([str(directory), env.get("PATH", "")])
    return directory


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def _unpack(archive: Path, destination: Path) -> None:
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as bundle:
            # Member by member: `extract` drops `..` and absolute paths itself, and the
            # archive has already matched the digest nodejs.org publishes for it.
            for member in bundle.namelist():
                bundle.extract(member, destination)
    else:
        with tarfile.open(archive) as bundle:
            bundle.extractall(destination, filter="tar")


def provision(root: Path = REPO_ROOT, fetch=_fetch) -> int:
    """Download and cache `.nvmrc`'s line when PATH's `node` is another. 0 on success.

    Idempotent: a matching PATH node or an existing cached build returns at once.
    """
    major = pinned_major(root)
    if not major:
        return 0
    if path_node_major() == major or cached_install(major) is not None:
        return 0
    suffix = asset_suffix()
    release = f"{DIST_URL}/latest-v{major}.x"
    name, digest = pick_asset(fetch(f"{release}/SHASUMS256.txt").decode("utf-8"), suffix)
    print(f"[bootstrap] PATH has no Node {major}; fetching {name} (.nvmrc) into {cache_root()}")
    payload = fetch(f"{release}/{name}")
    if hashlib.sha256(payload).hexdigest() != digest:
        print(f"[bootstrap] {name} does not match its published sha256", file=sys.stderr)
        return 1
    target = cache_root()
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target) as scratch:
        archive = Path(scratch) / name
        archive.write_bytes(payload)
        _unpack(archive, Path(scratch) / "out")
        unpacked = next((Path(scratch) / "out").iterdir())
        final = target / unpacked.name
        # Rename within one directory: a concurrent bootstrap sees the whole build or
        # none of it, never a half-extracted tree that `cached_install` accepts. Losing
        # that race to another worktree's bootstrap is success, not an error.
        try:
            unpacked.rename(final)
        except OSError:
            if not final.exists():
                raise
    return 0
