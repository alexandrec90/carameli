"""The interpreter pin must exist, and must name the same version the image runs.

`.python-version` is the pin every tool in this repo's provisioning path already reads:
`uv venv` takes it with no argument, and devkit's `worktree.py provision` reads it first
of its `PIN_FILES` when deciding what interpreter to build an ephemeral box's `.venv` on.
Without it, a box -- and a bare `uv venv` on a workstation -- silently takes the machine
default, and the mismatch surfaces later as an install or type-check failure that reads
as a broken branch rather than as the wrong interpreter.

The pin living here rather than in `.devkit.toml` is deliberate: `[python] version` is a
manifest key the vendored harness in this repo does not know, so `scripts/hooks/tests/
test_repo_contract.py` rejects it as a typo. `.python-version` needs no harness support
and is consumed by uv directly.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

FROM_PYTHON = re.compile(r"^FROM\s+python:(\d+\.\d+(?:\.\d+)?)", re.MULTILINE)


def _pinned_version() -> str:
    path = REPO / ".python-version"
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


def _dockerfile_version() -> str:
    match = FROM_PYTHON.search((REPO / "Dockerfile").read_text(encoding="utf-8"))
    assert match, "no `FROM python:<version>` stage found in Dockerfile"
    return match.group(1)


def test_the_repo_pins_an_interpreter() -> None:
    assert _pinned_version(), (
        "no .python-version -- `uv venv` and every ephemeral box fall back to the "
        "workstation's default interpreter"
    )


def test_the_pin_matches_the_dockerfile() -> None:
    docker = _dockerfile_version()
    assert _pinned_version() == docker, (
        f".python-version pins {_pinned_version()!r} but the Dockerfile builds on "
        f"{docker!r} -- keep the two in step so a venv matches the container"
    )


def test_every_from_python_stage_agrees() -> None:
    """A multi-stage build with a builder on one minor and a runtime on another would
    make `test_the_pin_matches_the_dockerfile` pass against whichever came first."""
    versions = set(FROM_PYTHON.findall((REPO / "Dockerfile").read_text(encoding="utf-8")))
    assert len(versions) == 1, f"Dockerfile builds on more than one Python: {sorted(versions)}"


def test_the_pin_is_a_bare_version_uv_can_consume() -> None:
    """`uv venv` reads this file verbatim; a comment, a `cpython-` prefix or a range
    would be passed through and fail at box-provisioning time, not here."""
    assert re.fullmatch(r"\d+\.\d+(?:\.\d+)?", _pinned_version()), (
        f"{_pinned_version()!r} is not a bare version `uv venv --python` accepts"
    )
