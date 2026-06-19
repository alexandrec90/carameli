"""Unit tests for the enforce-capped-bash PreToolUse hook decision logic."""
import json

import pytest

from conftest import load_module

hook = load_module('scripts/hooks/enforce-capped-bash.py')


def payload(tool_name, command=None):
    body = {'tool_name': tool_name, 'tool_input': {}}
    if command is not None:
        body['tool_input']['command'] = command
    return json.dumps(body)


# --- decide: allow paths ---

def test_empty_stdin_allows():
    assert hook.decide('') == (0, '')
    assert hook.decide('   \n') == (0, '')


def test_malformed_json_allows_with_note():
    code, msg = hook.decide('{not json')
    assert code == 0
    assert 'unable to parse' in msg


def test_non_bash_tool_allows_silently():
    assert hook.decide(payload('Read', 'rm -rf /')) == (0, '')


def test_capped_with_invoke_wrapper_allows():
    cmd = 'python3 scripts/hooks/invoke-capped.py --command "ls" --max-bytes 4000'
    code, msg = hook.decide(payload('Bash', cmd))
    assert code == 0
    assert msg == ''


def test_capped_with_head_c_allows():
    code, _ = hook.decide(payload('Bash', 'cat big.log | head -c 4000'))
    assert code == 0


def test_capped_with_ps1_wrapper_allows():
    cmd = 'pwsh -File scripts/hooks/invoke-capped.ps1 -Command "ls"'
    code, _ = hook.decide(payload('Bash', cmd))
    assert code == 0


# --- decide: block paths ---

def test_uncapped_bash_blocks():
    code, msg = hook.decide(payload('Bash', 'ls -la'))
    assert code == 42
    assert 'Blocked uncapped Bash command' in msg


def test_missing_command_blocks():
    code, msg = hook.decide(payload('Bash'))
    assert code == 42
    assert 'missing command text' in msg


def test_blank_command_blocks():
    code, msg = hook.decide(payload('Bash', '   '))
    assert code == 42
    assert 'missing command text' in msg


# --- alternate payload shapes ---

@pytest.mark.parametrize('raw', [
    '{"toolName":"Bash","toolInput":{"command":"ls"}}',
    '{"tool":{"name":"Bash"},"input":{"command":"ls"}}',
    '{"name":"Bash","command":"ls"}',
])
def test_alternate_key_shapes_still_block_uncapped(raw):
    code, _ = hook.decide(raw)
    assert code == 42


# --- is_capped / get_value units ---

def test_is_capped_true_and_false():
    assert hook.is_capped('foo | head -c 100') is True
    assert hook.is_capped('plain command') is False


def test_get_value_dotted_and_missing():
    obj = {'tool_input': {'command': 'x'}}
    assert hook.get_value(obj, 'tool_input.command') == 'x'
    assert hook.get_value(obj, 'missing.path', 'tool_input.command') == 'x'
    assert hook.get_value(obj, 'nope') is None
