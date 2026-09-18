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


def test_mypy_typechecks_against_the_pin() -> None:
    """`mypy.ini` cannot read a file, so the literal in it has to be gated instead.

    It is not cosmetic: `python_version` decides which stdlib stubs and which
    version-gated branches mypy analyses, so a config left behind on an older minor
    type-checks code the interpreter will never run and misses code it will.
    """
    text = (REPO / "mypy.ini").read_text(encoding="utf-8")
    match = re.search(r"^python_version\s*=\s*(\S+)", text, re.MULTILINE)
    assert match, "mypy.ini sets no python_version"
    assert match.group(1) == _pinned_version(), (
        f"mypy.ini type-checks for {match.group(1)!r} but the repo runs {_pinned_version()!r}"
    )


def test_ruff_targets_the_pin() -> None:
    """`ruff.toml`'s `target-version` is the same literal in a different spelling.

    It decides which syntax ruff accepts and which rewrites it offers, so a stale one
    lets through code the interpreter cannot parse, or proposes a fix for a version
    nothing runs. Like `mypy.ini` it can read no file, so it is gated here.
    """
    text = (REPO / "ruff.toml").read_text(encoding="utf-8")
    match = re.search(r"^target-version\s*=\s*[\"']py(\d+)[\"']", text, re.MULTILINE)
    assert match, "ruff.toml sets no target-version"
    major, minor = _pinned_version().split(".")[:2]
    assert match.group(1) == f"{major}{minor}", (
        f"ruff.toml targets py{match.group(1)} but the repo runs {_pinned_version()}"
    )


def test_no_workflow_spells_out_a_python_version() -> None:
    """`actions/setup-python` takes `python-version-file`, so CI can read the pin the
    same way everything else does.

    A `python-version: "3.x"` literal in a workflow is the copy that goes stale
    silently -- the job installs an interpreter the locks were not compiled for, and
    every failure downstream of it reads as a dependency problem. Covers the disabled
    workflows too: a re-enabled one carries whatever it was frozen with.
    """
    literals: dict[str, list[str]] = {}
    for path in sorted((REPO / ".github").rglob("*")):
        if not path.is_file() or path.suffix not in {".yml", ".yaml", ".disabled"}:
            continue
        found = re.findall(
            r"^\s*python-version:\s*[\"']?([\d.]+)", path.read_text(encoding="utf-8"), re.MULTILINE
        )
        if found:
            literals[str(path.relative_to(REPO)).replace("\\", "/")] = sorted(set(found))
    assert not literals, (
        f"use `python-version-file: .python-version` instead of a literal: {literals}"
    )
