#!/usr/bin/env python3
"""Small cross-platform helpers shared by the standalone runner scripts.

Pure helper `venv_exe` is unit-tested in
`scripts/hooks/tests/test_script_common.py`.
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def venv_rel_parts(name: str, os_name: str = os.name) -> tuple[str, str, str]:
    """OS-correct (.venv subdir, bindir, filename) for a console script.

    Windows venvs put executables in `.venv/Scripts/<name>.exe`; POSIX venvs use
    `.venv/bin/<name>`. Pure so it can be tested without touching `os.name`.
    """
    if os_name == "nt":
        return ".venv", "Scripts", f"{name}.exe"
    return ".venv", "bin", name


def venv_exe(name: str, repo_root: Path = REPO_ROOT) -> Path:
    """Path to a venv console script, picking the OS-correct layout."""
    return repo_root.joinpath(*venv_rel_parts(name))
