#!/usr/bin/env python3
"""fix-tests-auto helper: restarts the app container when app/ has changed.

Hashes the current `git diff` of `app/` and, when it differs from the last
recorded hash, restarts the Docker app container so fixes take effect. The
restart is a desktop/Docker-only concern: it shells to the existing
`scripts/docker-restart-app.py`. On mobile sessions the fix-tests-auto marker is
never set, so this never runs there.

Pure `app_diff_hash` is unit-tested via
`scripts/hooks/tests/test_restart_if_app_diff.py`.
"""

import hashlib
import subprocess
import sys
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / "../../..").resolve()
MARKER = Path(__file__).parent / ".app-restart-hash"


def app_diff_hash(changed_output: str) -> str | None:
    """Hash the sorted, trimmed list of changed app/ files. None if no changes."""
    files = sorted(ln.strip() for ln in changed_output.splitlines() if ln.strip())
    if not files:
        return None
    return hashlib.sha256("\n".join(files).encode("utf-8")).hexdigest()


def get_app_diff(repo_root: Path) -> str | None:
    """Return `git diff --name-only -- app` output, or None on git failure."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--", "app"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def restart_app(repo_root: Path) -> int:
    """Restart the Docker app container via the existing python task."""
    result = subprocess.run(
        [sys.executable, "scripts/docker-restart-app.py"],
        cwd=repo_root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode


def main() -> int:
    changed = get_app_diff(REPO_ROOT)
    if changed is None:
        return 0

    current_hash = app_diff_hash(changed)
    if current_hash is None:
        MARKER.unlink(missing_ok=True)
        return 0

    previous_hash = MARKER.read_text(encoding="utf-8").strip() if MARKER.exists() else ""
    if previous_hash == current_hash:
        return 0

    code = restart_app(REPO_ROOT)
    if code != 0:
        return code

    MARKER.write_text(current_hash, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
