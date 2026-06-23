#!/usr/bin/env python3
"""test-skill helper: writes marker artifacts proving a hook/bang path ran.

Used by the test-skill harness to confirm that frontmatter hooks and bang
commands fire. Pure `write_artifacts` is unit-tested via
`scripts/hooks/tests/test_write_artifacts.py`.
"""
import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / '../../..').resolve()


def write_artifacts(mode: str, repo_root: Path, timestamp: str) -> list[Path]:
    """Write the artifacts for `mode` ('hook' or 'bang'). Returns written paths."""
    log_dir = repo_root / 'logs/agent'
    log_dir.mkdir(parents=True, exist_ok=True)

    if mode == 'hook':
        target = log_dir / 'test-skill-hook.txt'
        target.write_text(f'hello from frontmatter hook at {timestamp}')
        return [target]

    bang = log_dir / 'test-skill-bang.txt'
    sentinel = log_dir / 'test-skill-sentinel.txt'
    bang.write_text(f'hello from bang command at {timestamp}')
    sentinel.write_text(f'hello from test-skill at {timestamp}')
    return [bang, sentinel]


def main() -> int:
    parser = argparse.ArgumentParser(description='Write test-skill marker artifacts.')
    parser.add_argument('--mode', required=True, choices=('hook', 'bang'))
    args = parser.parse_args()

    written = write_artifacts(args.mode, REPO_ROOT, datetime.now(UTC).isoformat())
    if args.mode == 'bang':
        for path in written:
            print(path.read_text())
    return 0


if __name__ == '__main__':
    sys.exit(main())
