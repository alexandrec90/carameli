#!/usr/bin/env python3
"""PostToolUse hook: reminds about Alembic migration when app/models/*.py changes."""
import json
import re
import subprocess
import sys
from pathlib import Path

ALLOWED_TOOLS = {'Edit', 'Write', 'MultiEdit', 'apply_patch', 'create_file'}
REPO_ROOT = (Path(__file__).parent / '../../..').resolve()
MARKER = Path(__file__).parent / '.migration-needed'


def main():
    hook_input = None
    try:
        raw = sys.stdin.read()
        if raw:
            hook_input = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        pass

    if hook_input:
        tool_name = hook_input.get('tool_name') or hook_input.get('toolName', '')
        if tool_name and tool_name not in ALLOWED_TOOLS:
            return

        tool_input = hook_input.get('tool_input') or hook_input.get('toolInput') or {}
        if not re.search(r'app[/\\]+models[/\\]+[^/\\]+\.py', json.dumps(tool_input)):
            return

    try:
        result = subprocess.run(
            ['git', 'status', '--porcelain', '--', 'app/models/*.py'],
            cwd=REPO_ROOT, capture_output=True, text=True
        )
        changed = [ln for ln in result.stdout.splitlines() if ln and '__init__.py' not in ln]
    except Exception:
        return

    if not changed:
        MARKER.unlink(missing_ok=True)
        return

    if MARKER.exists():
        return

    MARKER.write_text('pending')
    print()
    print('MIGRATION NEEDED: app/models/ files have uncommitted changes.')
    print('Once all model edits are complete, tell the user to run:')
    print('  docker compose exec -T app alembic revision --autogenerate -m "<description>"')
    print('Then open the new file in alembic/versions/ and verify columns, FK behaviour,')
    print('indexes, and gen_random_uuid() defaults before applying with: alembic upgrade head')
    print()


main()
