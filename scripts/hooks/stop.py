#!/usr/bin/env python3
"""Stop hook (portable): saves optimize-fixers snapshot when skills-profile.json exists.

`save_snapshot` takes explicit paths so it can be unit-tested with a tmp dir
(`scripts/hooks/tests/test_stop.py`).
"""
import shutil
import sys
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / '../..').resolve()
PROFILE = REPO_ROOT / 'logs/agent/skills-profile.json'
SNAPSHOT = REPO_ROOT / 'logs/agent/skills-profile.optimized.json'


def save_snapshot(profile: Path, snapshot: Path) -> int:
    """Copy `profile` to `snapshot` if it exists. Returns process exit code."""
    if not profile.exists():
        return 0
    try:
        shutil.copy2(profile, snapshot)
    except OSError as exc:
        print(f'stop.py: could not save optimize-fixers snapshot: {exc}', file=sys.stderr)
        return 1
    return 0


def main() -> int:
    return save_snapshot(PROFILE, SNAPSHOT)


if __name__ == '__main__':
    sys.exit(main())
