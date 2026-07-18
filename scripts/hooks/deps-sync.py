#!/usr/bin/env python3
"""Reinstall local dependencies when a dependency manifest changes.

Runs as a git post-merge / post-checkout / post-commit hook (installed by
`--install`) and as the "Deps: Sync Local Environment" VS Code task — pulls,
branch switches, and local manifest-editing commits all trigger the same
fingerprint check. Compares a SHA-256 fingerprint
of the dependency manifests against the one recorded in `.git/deps-fingerprint.json`:

- First run (no recorded state): records a baseline, installs nothing. A fresh
  clone runs its initial install explicitly via the Install tasks.
- Manifest changed since last record: runs the matching reinstall
  (`npm install` for the frontend lockfile, `pip install -r` for requirements)
  and re-records only on success, so a failed install retries next time.
- No change: exits quietly — cheap enough to run on every checkout.

stdlib only (hooks run before the venv is activated). Pure functions are
importable for tests; side effects live under `__main__`/`main()`.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
STATE_FILE = REPO_ROOT / ".git" / "deps-fingerprint.json"
HOOK_NAMES = ("post-merge", "post-checkout", "post-commit")

# Manifest -> what a change to it invalidates. "npm"/"pip" trigger a local
# reinstall; "docker" only prints a staleness notice -- rebuilding is slow,
# needs the daemon up, and can drop a live session, so it stays a manual task.
MANIFESTS = {
    "frontend/package-lock.json": ("npm",),
    "requirements.txt": ("pip", "docker"),
    # The compose dev image target bakes in requirements-test.txt (in-container
    # pytest toolchain), so a change to it makes the app container stale. The
    # host venv installs the dev lock, which includes the test pins via -r.
    "requirements-test.txt": ("docker",),
    "requirements-dev.txt": ("pip",),
    "requirements.in": ("lock",),
    "requirements-test.in": ("lock",),
    "requirements-dev.in": ("lock",),
    "Dockerfile": ("docker",),
    "docker-compose.yml": ("docker",),
    "docker-compose.override.yml": ("docker",),
}

DOCKER_NOTICE = (
    "[deps-sync] app container is now stale (requirements*.txt / Dockerfile / compose "
    "changed) -> run the 'Docker: Rebuild App' or 'Start: Full Stack (Docker Compose)' task"
)

LOCK_NOTICE = (
    "[deps-sync] requirements*.in changed -- if the matching requirements*.txt lock was "
    "not recompiled, run the 'Deps: Recompile Python Lockfiles' task"
)

SHIM = """#!/bin/sh
# Installed by scripts/hooks/deps-sync.py --install -- do not hand-edit.
# Reinstalls local deps when a dependency manifest changed. See that script.
# The installed hook outlives branch switches; skip on trees that predate the script.
[ -f scripts/hooks/deps-sync.py ] || exit 0
python scripts/hooks/deps-sync.py
"""


def fingerprint(root: Path) -> dict[str, str]:
    """SHA-256 per manifest that exists under root (missing files are omitted)."""
    out: dict[str, str] = {}
    for rel in MANIFESTS:
        path = root / rel
        if path.is_file():
            out[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def changed_manifests(current: dict[str, str], recorded: dict[str, str]) -> list[str]:
    """Manifests whose hash differs from the recorded state (new files count)."""
    return [rel for rel, digest in current.items() if recorded.get(rel) != digest]


def plan(
    changed: list[str], root: Path, venv_python: Path | None
) -> list[tuple[str, list[str], Path]]:
    """(description, argv, cwd) per required install. Pure -- executes nothing."""
    installs: list[tuple[str, list[str], Path]] = []
    kinds = {kind for rel in changed for kind in MANIFESTS[rel]}
    if "npm" in kinds:
        npm = shutil.which("npm")
        if npm is None:
            print("[deps-sync] npm not on PATH -- skipping frontend install", file=sys.stderr)
        else:
            installs.append(
                ("frontend/package-lock.json -> npm install", [npm, "install"], root / "frontend")
            )
    if "pip" in kinds:
        py = str(venv_python) if venv_python else sys.executable
        # uv (installed into the venv via the dev lock) is the installer, same
        # resolver as the compiled locks. `--python <py>` targets the venv so
        # packages land there rather than in uv's own environment.
        installs.append(
            (
                "requirements*.txt -> uv pip install",
                [
                    py,
                    "-m",
                    "uv",
                    "pip",
                    "install",
                    "-q",
                    "--python",
                    py,
                    "-r",
                    "requirements.txt",
                    "-r",
                    "requirements-dev.txt",
                ],
                root,
            )
        )
    return installs


def install_hooks(hooks_dir: Path) -> list[Path]:
    """Write the post-merge/post-checkout shims. Refuses to clobber foreign hooks."""
    written: list[Path] = []
    for name in HOOK_NAMES:
        hook = hooks_dir / name
        if hook.exists() and "deps-sync.py" not in hook.read_text(encoding="utf-8"):
            print(
                f"[deps-sync] {hook.name} exists and is not ours -- left untouched", file=sys.stderr
            )
            continue
        hook.write_text(SHIM, encoding="utf-8", newline="\n")
        written.append(hook)
    return written


def main(argv: list[str]) -> int:
    if "--install" in argv:
        written = install_hooks(REPO_ROOT / ".git" / "hooks")
        for hook in written:
            print(f"[deps-sync] installed {hook.relative_to(REPO_ROOT)}")
        return 0 if written else 1

    current = fingerprint(REPO_ROOT)
    if not STATE_FILE.exists():
        STATE_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
        print("[deps-sync] baseline recorded -- no install on first run")
        return 0

    recorded = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    changed = changed_manifests(current, recorded)
    if not changed:
        return 0

    if any("docker" in MANIFESTS[rel] for rel in changed):
        print(DOCKER_NOTICE)
    if any("lock" in MANIFESTS[rel] for rel in changed) and not any(
        "pip" in MANIFESTS[rel] for rel in changed
    ):
        print(LOCK_NOTICE)

    venv_python = REPO_ROOT / ".venv" / "Scripts" / "python.exe"
    installs = plan(changed, REPO_ROOT, venv_python if venv_python.exists() else None)
    for description, _argv, _cwd in installs:
        print(f"[deps-sync] {description}")

    def run_install(item: tuple[str, list[str], Path]) -> tuple[str, int]:
        description, argv_, cwd = item
        return description, subprocess.run(argv_, cwd=cwd).returncode

    # npm and pip installs are independent (separate toolchains/directories) --
    # run them concurrently instead of paying the sum of both durations.
    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, len(installs))) as pool:
        for description, returncode in pool.map(run_install, installs):
            if returncode != 0:
                print(
                    f"[deps-sync] FAILED: {description} -- will retry on next run", file=sys.stderr
                )
                failures += 1

    if failures == 0:
        STATE_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
        print(f"[deps-sync] done -- {len(changed)} manifest(s) synced")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
