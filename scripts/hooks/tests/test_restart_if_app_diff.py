"""Unit tests for the fix-tests-auto app-restart helper."""
from conftest import load_module

hook = load_module('.claude/skills/fix-tests-auto/restart-if-app-diff.py')


def test_no_changes_returns_none():
    assert hook.app_diff_hash('') is None
    assert hook.app_diff_hash('   \n  \n') is None


def test_hash_is_stable_and_order_independent():
    a = hook.app_diff_hash('app/b.py\napp/a.py\n')
    b = hook.app_diff_hash('app/a.py\napp/b.py')
    assert a == b
    assert len(a) == 64  # sha256 hex


def test_hash_changes_with_content():
    assert hook.app_diff_hash('app/a.py') != hook.app_diff_hash('app/b.py')


def test_restart_app_noop_without_pwsh(tmp_path, monkeypatch):
    monkeypatch.setattr(hook.shutil, 'which', lambda _: None)
    assert hook.restart_app(tmp_path) == 0
