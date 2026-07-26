#!/usr/bin/env python3
"""PreToolUse hook: blocks Bash tool calls that lack an output byte-cap wrapper.

Decision logic is exposed as pure functions (`decide`, `is_capped`, `get_value`)
so it can be unit-tested via pytest without spawning a subprocess. See
`scripts/hooks/tests/test_enforce_capped_bash.py`.
"""

import json
import re
import sys

DEFAULT_MAX_BYTES = 4000

# Claude Code hook contract: 0 allows the call, 2 blocks it and feeds stderr back
# to the model. Every other non-zero code is reported as a non-blocking hook
# *error* and the tool call proceeds anyway -- so a blocking hook MUST use 2 and
# MUST write its reason to stderr. See scripts/hooks/tests/test_hook_exit_contract.py.
EXIT_BLOCK = 2

ALLOWED_PATTERNS = [
    r"scripts/hooks/invoke-capped\.py",
    r"\|\s*head\s*-c\s*\d+",
]

BLOCK_MESSAGE = (
    f"Blocked uncapped Bash command. Route output through a byte-cap wrapper "
    f"(default {DEFAULT_MAX_BYTES} bytes).\n"
    "Suggested pattern: "
    'python3 scripts/hooks/invoke-capped.py --command "<your command>" --max-bytes 4000'
)


def get_value(obj, *paths):
    """Return the first present dotted-path value (as str) from a nested dict."""
    for path in paths:
        cur = obj
        ok = True
        for key in path.split("."):
            if not isinstance(cur, dict) or key not in cur:
                ok = False
                break
            cur = cur[key]
        if ok and cur is not None:
            return str(cur)
    return None


def is_capped(command: str) -> bool:
    """True if the command already routes output through an allowed cap wrapper."""
    return any(re.search(pattern, command) for pattern in ALLOWED_PATTERNS)


def decide(raw: str) -> tuple[int, str]:
    """Pure decision: map raw stdin payload to (exit_code, message).

    exit_code 0 allows the call, EXIT_BLOCK blocks it. message may be empty.
    """
    if not raw.strip():
        return 0, ""

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0, "enforce-capped-bash: unable to parse hook payload; skipping enforcement."

    tool_name = get_value(payload, "tool_name", "toolName", "tool.name", "name")
    if tool_name != "Bash":
        return 0, ""

    command = get_value(
        payload, "tool_input.command", "toolInput.command", "input.command", "command"
    )
    if not command or not command.strip():
        return (
            EXIT_BLOCK,
            "enforce-capped-bash: Bash tool call is missing command text; blocking by policy.",
        )

    if is_capped(command):
        return 0, ""

    return EXIT_BLOCK, BLOCK_MESSAGE


def main() -> int:
    exit_code, message = decide(sys.stdin.read())
    if message:
        # stderr, not stdout: only stderr is surfaced for a blocking hook.
        print(message, file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
