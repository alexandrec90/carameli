#!/usr/bin/env python3
"""PostToolUse hook: reminds about an Alembic migration when app/models/*.py changes.

Pure decision helpers (`parse_hook_input`, `should_check_git`, `filter_changed`)
are unit-tested via pytest (`scripts/hooks/tests/test_after_model_edit.py`).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ALLOWED_TOOLS = {'Edit', 'Write', 'MultiEdit', 'apply_patch', 'create_file'}
MODEL_PATH_RE = re.compile(r'app[/\\]+models[/\\]+[^/\\]+\.py')
REPO_ROOT = (Path(__file__).parent / '../../..').resolve()
MARKER = Path(__file__).parent / '.migration-needed'

REMINDER_TEXT = (
    '\n'
    'MIGRATION NEEDED: app/models/ files have uncommitted changes.\n'
    'Once all model edits are complete, generate the migration:\n'
    '  docker compose exec -T app alembic revision --autogenerate -m "<description>"\n'
    'Then open the new file in alembic/versions/ and verify columns, FK behaviour,\n'
    'indexes, and gen_random_uuid() defaults before applying with: alembic upgrade head\n'
)


def parse_hook_input(raw: str):
    """Parse raw stdin into a dict, or None when absent/malformed."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None


def should_check_git(hook_input) -> bool:
    """Decide whether to run the git status check for this hook payload.

    A missing payload short-circuits to True (run the check). A payload for a
    non-matching tool or a non-model file target returns False (skip).
    """
    if not hook_input:
        return True

    tool_name = hook_input.get('tool_name') or hook_input.get('toolName', '')
    if tool_name and tool_name not in ALLOWED_TOOLS:
        return False

    tool_input = hook_input.get('tool_input') or hook_input.get('toolInput') or {}
    return bool(MODEL_PATH_RE.search(json.dumps(tool_input)))


def filter_changed(porcelain_output: str) -> list[str]:
    """Keep only meaningful model-change lines from `git status --porcelain`."""
    return [ln for ln in porcelain_output.splitlines() if ln and '__init__.py' not in ln]


def get_changed(repo_root: Path):
    """Return filtered changed-model lines, or None on git failure."""
    try:
        result = subprocess.run(
            ['git', 'status', '--porcelain', '--', 'app/models/*.py'],
            cwd=repo_root, capture_output=True, text=True
        )
    except OSError:
        return None
    return filter_changed(result.stdout)


def main() -> int:
    hook_input = parse_hook_input(sys.stdin.read())
    if not should_check_git(hook_input):
        return 0

    changed = get_changed(REPO_ROOT)
    if changed is None:
        return 0

    if not changed:
        MARKER.unlink(missing_ok=True)
        return 0

    if MARKER.exists():
        return 0

    MARKER.write_text('pending')
    print(REMINDER_TEXT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
