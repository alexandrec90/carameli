#!/usr/bin/env python3
"""PreToolUse hook: blocks Bash tool calls that lack an output byte-cap wrapper."""
import json
import re
import sys

DEFAULT_MAX_BYTES = 4000

ALLOWED_PATTERNS = [
    r'scripts/hooks/invoke-capped\.py',
    r'scripts/hooks/invoke-capped\.ps1',
    r'\|\s*head\s*-c\s*\d+',
    r'Set-Content\s+.+\|\s*Out-Null',
]


def get_value(obj, *paths):
    for path in paths:
        cur = obj
        for key in path.split('.'):
            if not isinstance(cur, dict) or key not in cur:
                cur = None
                break
            cur = cur[key]
        if cur is not None:
            return str(cur)
    return None


raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

try:
    payload = json.loads(raw)
except json.JSONDecodeError:
    print('enforce-capped-bash: unable to parse hook payload; skipping enforcement.')
    sys.exit(0)

tool_name = get_value(payload, 'tool_name', 'toolName', 'tool.name', 'name')
if tool_name != 'Bash':
    sys.exit(0)

command = get_value(payload, 'tool_input.command', 'toolInput.command', 'input.command', 'command')
if not command or not command.strip():
    print('enforce-capped-bash: Bash tool call is missing command text; blocking by policy.')
    sys.exit(42)

for pattern in ALLOWED_PATTERNS:
    if re.search(pattern, command):
        sys.exit(0)

print(
    f'Blocked uncapped Bash command. Route output through a byte-cap wrapper '
    f'(default {DEFAULT_MAX_BYTES} bytes).'
)
print(
    'Suggested pattern: '
    'python3 scripts/hooks/invoke-capped.py --command "<your command>" --max-bytes 4000'
)
sys.exit(42)
