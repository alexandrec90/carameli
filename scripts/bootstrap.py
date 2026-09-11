#!/usr/bin/env python3
"""Provision a checkout: `.venv` on the image's interpreter, the dev lock, node_modules.

A linked worktree -- `claude --worktree`, `git worktree add`, a devkit box before it is
provisioned -- checks out **tracked files only**, so it has no `.venv` and no
`node_modules`. Everything that needs one then fails in whatever order it happens to be
reached, and each failure names a *tool* rather than the checkout. Sessions here have
repeatedly read that as a code problem: the recurring report is an agent that ran
`scripts/lint-all.py`, got a red run, worked out that the red was one absent binary,
installed that binary by hand, and moved on -- leaving every other check in the worktree
to fail the same way for the next command. `scripts/preflight.py` is the other half of
the fix: it stops the runners with the name of this script instead of a wall of
missing-binary errors. This is the command it names.

**The interpreter matters, and `python -m venv` cannot pick it.** It can only clone the
interpreter running it -- the workstation default -- while the venv has to match the
version the image runs, which is coordinated across the `FROM python:` tag in
`Dockerfile`, the uv-compiled locks, `mypy.ini`, `ruff.toml` and CI (`CLAUDE.md`, "Local
workflow"). So the version is read out of `Dockerfile`, the file that already enforces
it, rather than copied into this script or into `.devkit.toml`: a copied pin is
unenforced, and the stale copy then reads as policy. `uv venv --python` fetches that
interpreter when the machine has none.

Idempotent. Each tier is skipped when it is already present, so re-running is cheap and
a half-provisioned checkout (a venv but no `node_modules`, say) is finished rather than
rejected.

Pure functions are importable for tests; side effects live in `main()`. stdlib only --
this runs before anything is installed, by construction.
"""

from __future__ import annotations

import importlib.util
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "hooks"))
import harness_config
import toolchain

REPO_ROOT = Path(__file__).resolve().parents[1]

# `FROM python:3.12-slim` -> `3.12`. Only the leading numeric component of the tag is a
# version; the `-slim` / `-alpine` suffix names the image variant, which `uv` neither
# needs nor understands.
_FROM_PYTHON = re.compile(r"^FROM\s+python:(\d+(?:\.\d+)*)", re.MULTILINE)


def image_python_version(dockerfile_text: str) -> str:
    """The interpreter version the app image runs, from its first `FROM python:` tag.

    Raises rather than guessing: a default here would be a second, silent pin, and the
    venv it produced would be wrong in exactly the way this script exists to prevent.
    """
    match = _FROM_PYTHON.search(dockerfile_text)
    if not match:
        raise ValueError("Dockerfile has no `FROM python:<version>` tag to pin the venv to")
    return match.group(1)


def uv_argv(which=shutil.which) -> list[str] | None:
    """How to invoke uv here: on `PATH`, as a module, or `None` when it is absent.

    Structural detection (`shutil.which`, `find_spec`) rather than running `uv --version`
    and reading the error, per `.claude/rules/engineering.md`. The module form matters on
    a machine where uv was pip-installed into a Python whose `Scripts/` is not on `PATH`,
    which is the common Windows shape.
    """
    if which("uv"):
        return ["uv"]
    if importlib.util.find_spec("uv") is not None:
        return [sys.executable, "-m", "uv"]
    return None


def venv_argv(uv: list[str], version: str, root: Path) -> list[str]:
    """`uv venv` on the pinned interpreter, seeded with pip.

    `--seed` is load-bearing, not tidiness: `uv venv` leaves a venv with no `pip` in it,
    and `scripts/venv-install.py` -- the one install site where uv cannot already be
    present -- bootstraps uv through `python -m pip`. Without the seed that step dies
    with `No module named pip` in the one place that has no way to recover.
    """
    return [*uv, "venv", "--python", version, "--seed", str(root / ".venv")]


def npm_argv(root: Path, frontend_dir: str, which=shutil.which) -> list[str]:
    """The frontend install as argv, with the launcher resolved to a real path.

    On Windows `npm` is a `.cmd`/`.EXE` shim that a no-shell `subprocess.run` will not
    find from the bare name; `shutil.which` resolves it through `PATHEXT`. The command
    itself comes from `toolchain.frontend_fix`, the vendored ladder the SessionStart
    report and `ship.py --preflight` already print, so this cannot install differently
    from what the agent was told to run -- including its `ci` vs `install` choice, which
    is about not rewriting `package-lock.json` in a worktree.
    """
    argv = toolchain.frontend_fix(root, frontend_dir).split()
    resolved = which(argv[0])
    return [resolved, *argv[1:]] if resolved else argv


def venv_python(root: Path = REPO_ROOT) -> Path:
    """Path to the venv interpreter (OS-specific bin dir layout)."""
    if sys.platform.startswith("win"):
        return root / ".venv" / "Scripts" / "python.exe"
    return root / ".venv" / "bin" / "python"


def create_venv(root: Path = REPO_ROOT) -> int:
    """Create `.venv` on the interpreter the image runs. 0 when it exists or was created.

    Shared with `scripts/venv-install.py`, which used to create the venv from
    `sys.executable` and so produced one the container does not match on any machine
    whose default Python is not the pinned one.
    """
    python = venv_python(root)
    if python.exists():
        return 0
    version = image_python_version((root / "Dockerfile").read_text(encoding="utf-8"))
    uv = uv_argv()
    if uv is None:
        print(
            "[bootstrap] uv is required to create .venv on the interpreter this project "
            f"pins ({version}); `python -m venv` would clone this machine's default "
            "instead.\n[bootstrap] install it first: python -m pip install uv",
            file=sys.stderr,
        )
        return 1
    print(f"[bootstrap] creating .venv on Python {version} (Dockerfile `FROM python:` tag)")
    return subprocess.run(venv_argv(uv, version, root), cwd=root).returncode


def install_python(root: Path = REPO_ROOT) -> int:
    """Install the dev lock into `.venv` via `scripts/venv-install.py` (the one owner)."""
    script = root / "scripts" / "venv-install.py"
    return subprocess.run([sys.executable, str(script)], cwd=root).returncode


def install_frontend(root: Path = REPO_ROOT, cfg: harness_config.Config | None = None) -> int:
    """Install `node_modules` when this project has a frontend that lacks one."""
    config = harness_config.load(root) if cfg is None else cfg
    frontend = config.frontend
    if not frontend.enabled or not (root / frontend.dir).is_dir():
        return 0
    if (root / frontend.dir / "node_modules").is_dir():
        return 0
    print(f"[bootstrap] installing {frontend.dir}/node_modules")
    return subprocess.run(npm_argv(root, frontend.dir), cwd=root).returncode


def main() -> int:
    for step in (create_venv, install_python, install_frontend):
        code = step(REPO_ROOT)
        if code:
            return code
    print("[bootstrap] checkout provisioned -- lint, tests and the commit gate can run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
