#!/usr/bin/env python3
"""Small cross-platform helpers shared by the standalone runner scripts.

Pure helpers (`venv_exe`, `format_status_line`, `format_banner`) are unit-tested
in `scripts/hooks/tests/test_script_common.py`.

This module owns the **shared presentation contract** for the diagnostic runners
(`run-tests.py`, `lint-all.py`, `run-e2e.py`): every runner opens with the same
`print_suite_header` and closes with the same `emit_report`, so they all end with
an identical pass/fail banner and write their artifact the same way. The runners
only differ in how they produce results; the terminal-facing shell is uniform.

(The complementary filtering / artifact-format contract lives in
`scripts/diagnostics.py`, which is kept pure -- no I/O -- so it cannot host the
printing/file-writing parts. They belong here instead.)
"""

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[1]

# Status states a runner reports per item. Kept lowercase except FAIL so the
# bracketed tag visually pops in a wall of pass/skip lines.
PASS = "pass"  # noqa: S105 -- result state, not a credential
FAIL = "FAIL"
SKIP = "skip"

_BANNER_BAR = "  " + "=" * 42
_BANNER_WIDTH = len(_BANNER_BAR)


def load_script(rel: str, repo_root: Path = REPO_ROOT) -> ModuleType:
    """Import a hyphenated runner by path, so one can reuse another's pure helpers.

    `run-tests.py` and `lint-all.py` are not importable names, and the alternative to
    this is a second copy of whatever is being shared -- which is how `--changed` came
    to mean two different sets of files in the two runners at once.

    **Registered in `sys.modules` before `exec_module`**, and that is not a cache: a
    `@dataclass` under `from __future__ import annotations` resolves its own field
    annotations by looking the defining module up by name, and an unregistered module
    makes that lookup return `None` and the import die inside `dataclasses` with a
    traceback pointing at CPython. A loader that skips this works today and breaks the
    day the target grows a dataclass.
    """
    path = repo_root / rel
    name = f"_carameli_{path.stem.replace('-', '_')}"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


PYTHON_PIN = ".python-version"


def pinned_python(repo_root: Path = REPO_ROOT) -> str:
    """The interpreter version this repo is pinned to, read from `.python-version`.

    Every script that has to name a Python version -- the lock compiler, the ephemeral
    `uv run` fallback, the fix hints printed at people -- reads it here instead of
    spelling it out. A literal in one of those is not a duplicate of the pin, it is a
    *second* pin that no one remembers to move: `tests/unit/test_python_version_pin.py`
    can only gate the copies it knows about, and the ones it does not are found when a
    lock is compiled for an interpreter the image does not run.

    Deliberately unguarded. A missing `.python-version` is a broken checkout, and the
    failure everything here exists to prevent is precisely the quiet fallback to a
    default, so this raises rather than guessing.
    """
    return (repo_root / PYTHON_PIN).read_text(encoding="utf-8").strip()


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


def format_status_line(state: str, label: str) -> str:
    """One per-item result line, e.g. `  [FAIL] mypy`. Pure."""
    return f"  [{state}] {label}"


def format_banner(noun: str, passed: bool) -> list[str]:
    """The shared end-of-run banner block (blank, bar, centered text, bar, blank).

    `noun` is the suite word (`TESTS`, `LINT`, `E2E`); the text is always
    `<NOUN> PASSED` / `<NOUN> FAILED` centered under the bar. Pure so the exact
    framing is unit-tested.
    """
    msg = f"{noun} {'PASSED' if passed else 'FAILED'}"
    return ["", _BANNER_BAR, msg.center(_BANNER_WIDTH), _BANNER_BAR, ""]


def format_results_line(counts: tuple[int, int, int], unit: str = "total") -> str:
    """The shared `Results: ...` count line, e.g. `Results: 35 passed, 0 failed,
    3 skipped (38 tests)`. `unit` names what was counted (tests/checks). Pure."""
    passed, failed, skipped = counts
    total = passed + failed + skipped
    return f"Results: {passed} passed, {failed} failed, {skipped} skipped ({total} {unit})"


def print_suite_header(
    title: str, artifact_path: Path | str, extra_lines: list[str] | None = None
) -> None:
    """Print the shared `=== Carameli <title> ===` header before a run starts.

    Printed up front (not in `emit_report`) so the artifact path is visible while
    the suite runs. `extra_lines` carries per-suite detail (Mode/Runner/Target)
    and any trailing blank line for spacing.
    """
    print(f"\n=== Carameli {title} ===")
    print(f"Artifact : {artifact_path}")
    for line in extra_lines or []:
        print(line)


def emit_report(
    *,
    noun: str,
    artifact_path: Path | str,
    statuses: list[tuple[str, str]],
    artifact_text: str,
    failed: bool,
    counts: tuple[int, int, int] | None = None,
    unit: str = "total",
) -> int:
    """Print per-item statuses, write the artifact, print the banner, return code.

    The single closing call every runner shares, so all three end identically:
    per-item `[state] label` lines, then (if `counts` given) the shared
    `Results:` count line, then `Errors written to: <path>` on failure, then the
    banner. `artifact_text` is written verbatim (the empty string clears the
    artifact on a clean pass). Returns 1 on failure, 0 otherwise.
    """
    for state, label in statuses:
        print(format_status_line(state, label))

    artifact_path = Path(artifact_path)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(artifact_text, encoding="utf-8")

    if counts is not None:
        print("\n" + format_results_line(counts, unit))
    if failed:
        print(f"\nErrors written to: {artifact_path}")
    for line in format_banner(noun, passed=not failed):
        print(line)

    return 1 if failed else 0
