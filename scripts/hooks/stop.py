#!/usr/bin/env python3
"""Stop hook (portable): saves optimize-fixers snapshot when skills-profile.json exists."""
import shutil
import sys
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / '../..').resolve()
PROFILE = REPO_ROOT / 'logs/agent/skills-profile.json'
SNAPSHOT = REPO_ROOT / 'logs/agent/skills-profile.optimized.json'


def main():
    if not PROFILE.exists():
        sys.exit(0)
    try:
        shutil.copy2(PROFILE, SNAPSHOT)
    except Exception as exc:
        print(f'stop.py: could not save optimize-fixers snapshot: {exc}', file=sys.stderr)
        sys.exit(1)


main()
