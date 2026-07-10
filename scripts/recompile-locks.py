#!/usr/bin/env python3
"""Recompile every Python lockfile with uv's cross-platform resolver.

This is the single entry point used by both the local VS Code task and the
Dependabot repair workflow. Keeping the ordered constraint chain here prevents
the two environments from producing subtly different locks.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "deps-lock-errors.log"

LOCK_SPECS: tuple[tuple[str, str, str | None], ...] = (
    ("requirements.in", "requirements.txt", None),
    ("requirements-test.in", "requirements-test.txt", "requirements.txt"),
    ("requirements-dev.in", "requirements-dev.txt", "requirements-test.txt"),
)


def compile_commands(python: str) -> list[list[str]]:
    """Return the ordered universal-compile commands for all lock layers."""
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
            "3.12",
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
        f"requirements.in:1:1: LOCK_COMPILE_FAILED: `{rendered}` failed\n"
        f"{details}\n"
    )


def main() -> int:
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    code, output, failed_command = run_commands(compile_commands(sys.executable))
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
