"""`.devkit.toml` must pin the interpreter, and pin the same one the Dockerfile does.

Without `[python] version`, devkit's `worktree.py` infers the interpreter from the
Dockerfile's `FROM python:` tag and warns on every ephemeral box it spawns -- and that
warning is the first line of the worktree guard's PreToolUse stderr, where it surfaces
in every agent session as `PreToolUse:Edit hook error: ... no [python] version in
carameli/.devkit.toml`, ahead of the actual block message. The field being present is
what keeps that noise out of every guard block; it matching the Dockerfile is what
keeps the box's venv on the interpreter the container actually runs.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

FROM_PYTHON = re.compile(r"^FROM\s+python:(\d+\.\d+(?:\.\d+)?)", re.MULTILINE)


def _pinned_version() -> str:
    data = tomllib.loads((REPO / ".devkit.toml").read_text(encoding="utf-8"))
    return data.get("python", {}).get("version", "")


def test_devkit_toml_pins_a_python_version() -> None:
    assert _pinned_version(), (
        "no [python] version in .devkit.toml -- every box spawn will warn, and the "
        "warning lands as the first line of the worktree guard's block message"
    )


def test_the_pin_matches_the_dockerfile() -> None:
    match = FROM_PYTHON.search((REPO / "Dockerfile").read_text(encoding="utf-8"))
    assert match, "no `FROM python:<version>` stage found in Dockerfile"
    assert _pinned_version() == match.group(1), (
        f".devkit.toml pins {_pinned_version()!r} but the Dockerfile builds on "
        f"{match.group(1)!r} -- keep the two in step so a box's venv matches the container"
    )
