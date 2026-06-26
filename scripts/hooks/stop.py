#!/usr/bin/env python3
"""Stop dispatcher (portable replacement for copilot-settings-stop.ps1).

On every stop, best-effort and always exiting 0:
  - finalize state.json for the state-driven skills,
  - snapshot the optimize-fixers profile when present,
  - roll the just-ended session into skills-profile.json (archive-session.py),
  - normalize known-fixes tables when explicitly enabled,
  - typecheck the frontend when skin files changed.

`save_snapshot`, `skin_changed`, `should_normalize`, and `archive_targets_present`
are pure and unit-tested (`scripts/hooks/tests/test_stop.py`); each external step is
its own importable, independently tested script.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / "../..").resolve()
PROFILE = REPO_ROOT / "logs/agent/skills-profile.json"
SNAPSHOT = REPO_ROOT / "logs/agent/skills-profile.optimized.json"

FINALIZE_STATE = REPO_ROOT / "scripts/hooks/finalize-state.py"
NORMALIZE_KNOWN_FIXES = REPO_ROOT / "scripts/hooks/normalize-known-fixes.py"
ARCHIVE_SESSION = REPO_ROOT / "scripts/hooks/archive-session.py"

# (skill, schema) pairs finalized on every stop. Safe to call when artifacts are
# absent: finalize-state.py exits 0 in that case.
FINALIZE_TARGETS = (
    ("audit-design-flaws", "audit"),
    ("make-tests", "modules"),
    ("make-frontend-tests", "modules"),
    ("refactor", "files"),
)


def save_snapshot(profile: Path, snapshot: Path) -> int:
    """Copy `profile` to `snapshot` if it exists. Returns process exit code."""
    if not profile.exists():
        return 0
    try:
        shutil.copy2(profile, snapshot)
    except OSError as exc:
        print(f"stop.py: could not save optimize-fixers snapshot: {exc}", file=sys.stderr)
        return 1
    return 0


def should_normalize(env: dict[str, str]) -> bool:
    """True when known-fixes normalization is explicitly enabled."""
    return env.get("CARAMELI_NORMALIZE_KNOWN_FIXES_ON_STOP") == "1"


def archive_targets_present(raw_stdin: str) -> bool:
    """True when the Stop payload names a transcript worth archiving.

    archive-session.py self-guards on a missing transcript, but checking here
    avoids spawning a Python process for the common no-transcript stop.
    """
    try:
        payload = json.loads(raw_stdin)
    except (json.JSONDecodeError, TypeError):
        return False
    return bool(isinstance(payload, dict) and payload.get("transcript_path"))


def _read_stdin() -> str:
    """Best-effort read of the hook payload; '' when stdin is a tty or unreadable."""
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return ""
        return sys.stdin.read()
    except (OSError, ValueError):
        return ""


def skin_changed(porcelain: str) -> bool:
    """True when `git status --porcelain -- frontend/src/skins` reported changes."""
    return any(line.strip() for line in porcelain.splitlines())


def _git_skin_status(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--", "frontend/src/skins"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    return result.stdout if result.returncode == 0 else ""


def main() -> int:
    raw_stdin = _read_stdin()

    # State-driven skills: safe to call every stop.
    for skill, schema in FINALIZE_TARGETS:
        subprocess.run(
            [sys.executable, str(FINALIZE_STATE), "--skill", skill, "--schema", schema],
            cwd=REPO_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    # Snapshot the *current* profile as the optimize-fixers baseline, THEN roll the
    # just-ended session into the profile. This ordering leaves the profile ahead of
    # the snapshot by this session, so /optimize-fixers sees a non-empty delta.
    save_snapshot(PROFILE, SNAPSHOT)

    if archive_targets_present(raw_stdin):
        subprocess.run(
            [sys.executable, str(ARCHIVE_SESSION)],
            cwd=REPO_ROOT,
            input=raw_stdin,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    if should_normalize(os.environ):
        subprocess.run(
            [sys.executable, str(NORMALIZE_KNOWN_FIXES)],
            cwd=REPO_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    if skin_changed(_git_skin_status(REPO_ROOT)):
        npm = shutil.which("npm")
        if npm:
            subprocess.run(
                [npm, "run", "typecheck"],
                cwd=REPO_ROOT / "frontend",
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
