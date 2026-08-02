#!/usr/bin/env python3
"""Fail when the Python lockfiles lose their universal-compile environment markers.

Dependabot rewrites `requirements*.txt` in place with bare pins, stripping the
environment markers that `uv pip compile --universal` emits (it did this in
commit 223c1bf: 4 marker lines -> 0). A stripped lock makes `pip install -r`
on Windows try to build Linux-only packages (uvloop) and silently drops every
`sys_platform == 'win32'` package (colorama, pywin32, the win11toast/winrt
notification stack). Runs as a PR Gate job so those rewrites can't merge —
which matters now that dependabot-automerge.yml merges patch/minor bumps
without a human diff-read.

Checks a small set of sentinel packages per lock: each must be present and
carry its expected marker fragment. A sentinel disappearing legitimately
(e.g. uvicorn drops uvloop) fails loudly too — update SENTINELS in the same
change that recompiles the lock.

stdlib only. Pure functions are importable for tests; side effects live under
`__main__`/`main()`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

FIX_HINT = (
    "# fix: python -m uv pip compile --universal --python-version 3.12 "
    "requirements.in -o requirements.txt (same for -test and -dev; or run "
    "python scripts/recompile-locks.py)"
)

# Lock file -> sentinel package -> marker fragment its line must contain.
# These are the packages whose markers make the lock installable on both
# Linux (CI, container) and Windows (dev machines); a Dependabot rewrite
# strips the markers or drops the win32-only lines entirely.
SENTINELS: dict[str, dict[str, str]] = {
    "requirements.txt": {
        "uvloop": "sys_platform != 'win32'",
        "colorama": "sys_platform == 'win32'",
    },
    "requirements-test.txt": {
        "uvloop": "sys_platform != 'win32'",
        "colorama": "sys_platform == 'win32'",
    },
    "requirements-dev.txt": {
        "uvloop": "sys_platform != 'win32'",
        "colorama": "sys_platform == 'win32'",
        "pywin32": "sys_platform == 'win32'",
        "win11toast": "sys_platform == 'win32'",
    },
}

# `name==version` or `name[extra]==version ; markers` -- uv writes one
# requirement per line; `# via` annotations live on their own comment lines.
_PIN_RE = re.compile(r"^(?P<name>[A-Za-z0-9._-]+)(\[[^\]]*\])?==\S+(\s*;\s*(?P<marker>.*))?$")


def parse_pins(lock_text: str) -> dict[str, tuple[int, str]]:
    """Pinned package -> (1-based line number, marker text or '')."""
    pins: dict[str, tuple[int, str]] = {}
    for lineno, line in enumerate(lock_text.splitlines(), start=1):
        match = _PIN_RE.match(line.strip())
        if match:
            name = match.group("name").lower().replace("_", "-")
            pins[name] = (lineno, (match.group("marker") or "").strip())
    return pins


def find_violations(lock_text: str, filename: str, sentinels: dict[str, str]) -> list[str]:
    """Self-contained `file:line: message` errors for missing/unmarked sentinels."""
    pins = parse_pins(lock_text)
    violations: list[str] = []
    for name, fragment in sentinels.items():
        if name not in pins:
            violations.append(
                f"{filename}:1: sentinel package '{name}' is missing from the lock "
                f'(expected a pin with marker "{fragment}") -- either a Dependabot '
                f"rewrite dropped its platform-only line, or the dependency tree "
                f"changed and SENTINELS in scripts/check-lock-markers.py needs updating"
            )
            continue
        lineno, marker = pins[name]
        if fragment not in marker:
            violations.append(
                f"{filename}:{lineno}: '{name}' is pinned without its environment "
                f'marker (expected "{fragment}", found "{marker or "no marker"}") '
                f"-- the lock was likely rewritten in place instead of recompiled"
            )
    return violations


def main() -> int:
    all_violations: list[str] = []
    for filename, sentinels in SENTINELS.items():
        path = REPO_ROOT / filename
        if not path.is_file():
            all_violations.append(f"{filename}:1: lock file not found at {path}")
            continue
        all_violations.extend(
            find_violations(path.read_text(encoding="utf-8"), filename, sentinels)
        )

    if all_violations:
        print("# check-lock-markers")
        print(FIX_HINT)
        for violation in all_violations:
            print(violation)
        return 1

    print(f"[check-lock-markers] OK -- all sentinel markers present in {len(SENTINELS)} lockfiles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
