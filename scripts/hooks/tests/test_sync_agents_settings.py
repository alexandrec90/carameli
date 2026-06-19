"""Unit tests for the .agents/settings.json regenerator (hooks stripped)."""
import json

from conftest import load_module

hook = load_module('scripts/sync-agents-settings.py')


def test_strip_hooks_removes_hooks_keeps_rest():
    data = {'env': {'A': '1'}, 'permissions': {'allow': ['Read(*)']}, 'hooks': {'Stop': []}}
    result = hook.strip_hooks(data)
    assert 'hooks' not in result
    assert result['env'] == {'A': '1'}
    assert result['permissions'] == {'allow': ['Read(*)']}


def test_strip_hooks_no_hooks_is_unchanged():
    data = {'env': {'A': '1'}}
    assert hook.strip_hooks(data) == {'env': {'A': '1'}}


def test_strip_hooks_does_not_mutate_input():
    data = {'hooks': {'Stop': []}, 'env': {}}
    hook.strip_hooks(data)
    assert 'hooks' in data  # original untouched


def test_sync_writes_dest_without_hooks(tmp_path):
    src = tmp_path / 'claude.json'
    dest = tmp_path / 'agents.json'
    src.write_text(json.dumps({
        'env': {'X': '1'},
        'defaultModel': 'sonnet',
        'hooks': {'PreToolUse': [{'matcher': 'Bash'}]},
    }), encoding='utf-8')

    assert hook.sync(src, dest) == 0
    written = json.loads(dest.read_text(encoding='utf-8'))
    assert 'hooks' not in written
    assert written == {'env': {'X': '1'}, 'defaultModel': 'sonnet'}
    # Must emit LF (repo enforces eol=lf), never CRLF, regardless of OS.
    assert b'\r\n' not in dest.read_bytes()


def test_sync_missing_src_is_noop(tmp_path):
    src = tmp_path / 'missing.json'
    dest = tmp_path / 'agents.json'
    assert hook.sync(src, dest) == 0
    assert not dest.exists()
