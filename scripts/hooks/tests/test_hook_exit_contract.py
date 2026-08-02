"""Contract tests for the Claude Code hook exit-code protocol.

Claude Code interprets a hook's exit code as:

    0  -> allow the tool call
    2  -> BLOCK the tool call; stderr is fed back to the model
    *  -> non-blocking hook *error*; stderr is shown to the user and the
          tool call proceeds anyway

A blocking hook that picks any other non-zero code therefore does not block --
it degrades to a "hook error" banner while the call it meant to stop runs
regardless. That is a silent failure: the enforcement looks wired up, its unit
tests pass, and nothing is actually enforced.

This happened: both PreToolUse enforcers returned 42 and printed their reason to
stdout, so every blocked call surfaced as
"Failed with non-blocking status code: No stderr output" and was allowed through.
The pure-function tests asserted `code == 42` and passed, because they tested the
scripts against their own invented convention rather than the harness contract.

These tests pin the contract itself at the process boundary, so no hook can
regress to a private exit code again.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import load_module

REPO_ROOT = Path(__file__).resolve().parents[3]

# Every hook script that can block a tool call.
BLOCKING_HOOKS = [
    "scripts/hooks/enforce-capped-bash.py",
]

CONTRACT_BLOCK_CODE = 2


@pytest.mark.parametrize("script", BLOCKING_HOOKS)
def test_block_constant_matches_harness_contract(script):
    """A blocking hook must block with exit 2 -- not a private sentinel."""
    hook = load_module(script)
    assert hook.EXIT_BLOCK == CONTRACT_BLOCK_CODE, (
        f"{script} blocks with {hook.EXIT_BLOCK}, but Claude Code only treats 2 as "
        f"blocking. Any other non-zero code is reported as a non-blocking hook error "
        f"and the tool call proceeds anyway."
    )


def _run_hook(script: str, payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / script)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )


def test_capped_bash_blocks_with_exit_2_and_reason_on_stderr():
    """End-to-end: the reason must reach stderr, because only stderr is surfaced.

    This is the assertion the original unit tests could not make -- they called
    `decide()` directly and never observed which stream `main()` printed to.
    """
    result = _run_hook(
        "scripts/hooks/enforce-capped-bash.py",
        {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls -la"}},
    )

    assert result.returncode == CONTRACT_BLOCK_CODE
    assert result.stderr.strip(), "blocking reason must go to stderr or the user sees nothing"
    assert "cap" in result.stderr.lower()
    assert not result.stdout.strip(), "stdout is not surfaced for a blocking hook; use stderr"


def test_capped_bash_allows_capped_command_silently():
    result = _run_hook(
        "scripts/hooks/enforce-capped-bash.py",
        {
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": "ls -la | head -c 4000"},
        },
    )

    assert result.returncode == 0
    assert not result.stdout.strip()
    assert not result.stderr.strip()


def test_non_bash_tool_is_untouched():
    result = _run_hook(
        "scripts/hooks/enforce-capped-bash.py",
        {"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": {"file_path": "x.py"}},
    )

    assert result.returncode == 0


@pytest.mark.parametrize("script", BLOCKING_HOOKS)
def test_hooks_fail_open_on_empty_stdin(script):
    """A hook invoked with no payload must never block."""
    result = _run_hook_raw(script, "")
    assert result.returncode == 0


def _run_hook_raw(script: str, raw: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / script)],
        input=raw,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )


@pytest.mark.parametrize("script", BLOCKING_HOOKS)
def test_hooks_fail_open_on_malformed_payload(script):
    """Malformed JSON must not block the user's tool call."""
    result = _run_hook_raw(script, "{not json")
    assert result.returncode == 0
