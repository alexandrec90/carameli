#!/usr/bin/env python3
"""Regenerate .agents/settings.json from .claude/settings.json without `hooks`.

Codex reads both `.agents/settings.json` and `.codex/hooks.json`, so hooks live
in `.codex/hooks.json` only (single source). The `.claude` -> `.agents` mirror
must never carry a `hooks` block into `.agents/settings.json`, or Codex would
fire every hook twice. This keeps env/permissions/model in sync while stripping
hooks. Invoked by `scripts/sync-agents-context.ps1` after the directory mirror.

`strip_hooks` is pure and unit-tested
(`scripts/hooks/tests/test_sync_agents_settings.py`).
"""
import json
import sys
from pathlib import Path


def strip_hooks(data: dict) -> dict:
    """Return a copy of a settings dict with any top-level `hooks` key removed."""
    result = dict(data)
    result.pop('hooks', None)
    return result


def sync(src: Path, dest: Path) -> int:
    """Write `src` settings to `dest` with hooks stripped. No-op if src missing."""
    if not src.exists():
        return 0
    data = json.loads(src.read_text(encoding='utf-8'))
    # newline='' prevents Python's Windows text mode from translating \n -> CRLF;
    # the repo enforces eol=lf (.gitattributes), so emit LF to avoid churn.
    dest.write_text(json.dumps(strip_hooks(data), indent=2) + '\n', encoding='utf-8', newline='')
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2:
        src, dest = Path(argv[0]), Path(argv[1])
    else:
        repo_root = Path(__file__).resolve().parent.parent
        src = repo_root / '.claude/settings.json'
        dest = repo_root / '.agents/settings.json'
    return sync(src, dest)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
