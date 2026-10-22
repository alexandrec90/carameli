#!/usr/bin/env python3
"""Recompile every Python lockfile with uv's cross-platform resolver.

This is the single entry point used by both the local VS Code task and the
Dependabot repair workflow. Keeping the ordered constraint chain here prevents
the two environments from producing subtly different locks.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "deps-lock-errors.log"

LOCK_SPECS: tuple[tuple[str, str, str | None], ...] = (
    ("requirements.in", "requirements.txt", None),
    ("requirements-test.in", "requirements-test.txt", "requirements.txt"),
    ("requirements-dev.in", "requirements-dev.txt", "requirements-test.txt"),
)


def compile_commands(
    python: str,
    target_version: str | None = None,
    upgrade_packages: tuple[str, ...] = (),
) -> list[list[str]]:
    """Return the ordered universal-compile commands for all lock layers.

    `--python-version` is the repo's pin, not the interpreter running this script: a
    workstation on a newer Python must still produce locks the container can install.

    `upgrade_packages` lets a pin move in *every* layer. uv keeps an existing lock's
    pins, and each layer is constrained by the one before it, so a floor raised in
    `requirements-dev.in` cannot lift a shared transitive (`packaging`) that the
    runtime lock already holds lower: the dev compile reports the two as
    unsatisfiable instead.
    """
    target_version = target_version or script_common.pinned_python(REPO_ROOT)
    upgrade_args = [arg for package in upgrade_packages for arg in ("--upgrade-package", package)]
    commands: list[list[str]] = []
    for source, output, constraint in LOCK_SPECS:
        command = [
            python,
            "-m",
            "uv",
            "pip",
            "compile",
            "--universal",
            "--python-version",
            target_version,
            *upgrade_args,
            source,
            "-o",
            output,
        ]
        if constraint:
            command.extend(["-c", constraint])
        commands.append(command)
    return commands


def run_commands(commands: list[list[str]]) -> tuple[int, list[str], list[str] | None]:
    """Run commands in order, stopping at the first failed compilation."""
    output: list[str] = []
    for command in commands:
        result = subprocess.run(
            command,
            cwd=REPO_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        output.extend((result.stdout or "").splitlines())
        if result.returncode:
            return result.returncode, output, command
    return 0, output, None


def failure_report(command: list[str], output: list[str]) -> str:
    """Build the persisted, self-locating diagnostic for a failed compile."""
    rendered = " ".join(command)
    details = "\n".join(output[-80:]) or "recompile command produced no output"
    return (
        "# source: scripts/recompile-locks.py\n"
        "# recompile-locks\n"
        "# fix: python scripts/recompile-locks.py\n"
        "# hint: unsatisfiable against an earlier lock's pin? add --upgrade-package <name>\n"
        f"requirements.in:1:1: LOCK_COMPILE_FAILED: `{rendered}` failed\n"
        f"{details}\n"
    )


def main(argv: list[str] | None = None) -> int:
    # Parsing before anything runs makes `--help` print instead of recompiling.
    # No abbreviations: a bare `--upgrade` must be refused, not read as one package.
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument(
        "--upgrade-package",
        action="append",
        default=[],
        metavar="NAME",
        help="let this package's pin move in every lock layer (repeatable)",
    )
    args = parser.parse_args(argv)
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    commands = compile_commands(sys.executable, upgrade_packages=tuple(args.upgrade_package))
    code, output, failed_command = run_commands(commands)
    if code:
        if failed_command is None:
            failed_command = [sys.executable, "-m", "uv", "pip", "compile"]
        ARTIFACT.write_text(failure_report(failed_command, output), encoding="utf-8")
        print(f"Lockfile compilation failed; details: {ARTIFACT}")
        return code

    ARTIFACT.write_text("", encoding="utf-8")
    print("Recompiled 3 universal Python lockfiles.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
