"""Unit tests for the after-model-edit PostToolUse hook decision logic."""

import pytest
from conftest import load_module

hook = load_module('.claude/skills/add-db-model/after-model-edit.py')


# --- parse_hook_input ---

def test_parse_empty_is_none():
    assert hook.parse_hook_input('') is None


def test_parse_malformed_is_none():
    assert hook.parse_hook_input('{bad json') is None


def test_parse_valid_returns_dict():
    assert hook.parse_hook_input('{"tool_name":"Edit"}') == {'tool_name': 'Edit'}


# --- should_check_git ---

def test_none_payload_runs_check():
    # No payload -> fall through to git check (conservative).
    assert hook.should_check_git(None) is True


def test_non_matching_tool_skips():
    payload = {'tool_name': 'Read', 'tool_input': {'file_path': 'app/models/customer.py'}}
    assert hook.should_check_git(payload) is False


def test_non_model_path_skips():
    payload = {'tool_name': 'Edit', 'tool_input': {'file_path': 'app/api/vsapi/calls.py'}}
    assert hook.should_check_git(payload) is False


def test_model_path_edit_checks():
    payload = {'tool_name': 'Edit', 'tool_input': {'file_path': 'app/models/phone_line.py'}}
    assert hook.should_check_git(payload) is True


@pytest.mark.parametrize('tool', sorted(hook.ALLOWED_TOOLS))
def test_all_allowed_tools_check_on_model_path(tool):
    payload = {'tool_name': tool, 'tool_input': {'file_path': 'app/models/customer.py'}}
    assert hook.should_check_git(payload) is True


def test_camelcase_keys_supported():
    payload = {'toolName': 'Edit', 'toolInput': {'file_path': 'app/models/customer.py'}}
    assert hook.should_check_git(payload) is True


def test_windows_style_path_matches():
    payload = {'tool_name': 'Edit', 'tool_input': {'file_path': 'app\\models\\customer.py'}}
    assert hook.should_check_git(payload) is True


def test_payload_without_tool_name_but_model_path_checks():
    # Empty tool_name should not short-circuit; path match decides.
    payload = {'tool_input': {'file_path': 'app/models/customer.py'}}
    assert hook.should_check_git(payload) is True


# --- filter_changed ---

def test_filter_drops_init_and_blanks():
    porcelain = ' M app/models/customer.py\n M app/models/__init__.py\n\n M app/models/phone_line.py\n'
    assert hook.filter_changed(porcelain) == [
        ' M app/models/customer.py',
        ' M app/models/phone_line.py',
    ]


def test_filter_empty_output():
    assert hook.filter_changed('') == []


def test_filter_only_init_returns_empty():
    assert hook.filter_changed(' M app/models/__init__.py\n') == []


# --- reminder text contract ---

def test_reminder_text_mentions_migration_and_command():
    assert 'MIGRATION NEEDED' in hook.REMINDER_TEXT
    assert 'alembic revision --autogenerate' in hook.REMINDER_TEXT
