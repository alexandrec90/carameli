#!/usr/bin/env python3
"""Install the dev toolchain into the project venv with uv.

Backs the "Install: Dev Dependencies (venv)" VS Code task. This is the one
install site where uv cannot already be present -- a freshly created `.venv`
has nothing in it -- so it bootstraps uv with a single pip install (pinned to
the `uv==` line in requirements-dev.txt, single-sourced like every other uv
site), then lets uv do the real install of the dev lock. The dev lock is the
full superset (`-r requirements-test.in -> -r requirements.in`), so installing
it alone materializes runtime + test + host tooling.

`--python <venv>` targets the venv explicitly, so it installs there whether or
not a venv is already active (VS Code auto-activates its terminals; uv honors
the explicit flag over `VIRTUAL_ENV`).

Pure functions are importable for tests; side effects live under
`__main__`/`main()`. stdlib only.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_LOCK = "requirements-dev.txt"
_UV_PIN = re.compile(r"^uv==([^\s;]+)", re.MULTILINE)


def venv_python(root: Path, *, windows: bool | None = None) -> Path:
    """Path to the venv interpreter (OS-specific bin dir layout)."""
    if windows is None:
        windows = sys.platform.startswith("win")
    return root / ".venv" / ("Scripts" if windows else "bin") / (
        "python.exe" if windows else "python"
    )


def uv_pin(dev_lock_text: str) -> str:
    """The pinned uv version from the dev lock, or raise if it is absent."""
    match = _UV_PIN.search(dev_lock_text)
    if not match:
        raise ValueError(f"{DEV_LOCK} does not contain a `uv==` pin")
    return match.group(1)


def install_commands(python: Path, uv_version: str) -> list[list[str]]:
    """Ordered argv: bootstrap uv via pip, then install the dev lock via uv."""
    py = str(python)
    return [
        [py, "-m", "pip", "install", "--disable-pip-version-check", f"uv=={uv_version}"],
        [py, "-m", "uv", "pip", "install", "--python", py, "-r", DEV_LOCK],
    ]


def main() -> int:
    python = venv_python(REPO_ROOT)
    if not python.exists():
        print(f"[venv-install] creating virtual environment at {python.parent.parent}")
        subprocess.run([sys.executable, "-m", "venv", str(REPO_ROOT / ".venv")], check=True)
    version = uv_pin((REPO_ROOT / DEV_LOCK).read_text(encoding="utf-8"))
    for command in install_commands(python, version):
        result = subprocess.run(command, cwd=REPO_ROOT)
        if result.returncode:
            return result.returncode
    print("[venv-install] dev toolchain installed with uv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
