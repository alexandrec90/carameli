"""Tests for scripts/install-pre-commit.py pure helpers."""

from conftest import load_module

mod = load_module("scripts/install-pre-commit.py")


def _generated_hook() -> str:
    # A minimal stand-in for a freshly generated pre-commit hook ending.
    return "#!/usr/bin/env bash\nHERE=...\nARGS=(hook-impl ...)\n" + mod.OLD_TAIL


def test_patch_applies_to_generated_hook():
    new, status = mod.patch_hook_content(_generated_hook())
    assert status == "patched"
    assert "logs/pre-commit-errors.log" in new
    assert "Auto-fix retry" in new


def test_patch_idempotent_when_already_patched():
    already = "ARGS=(...)\n" + mod.NEW_TAIL
    new, status = mod.patch_hook_content(already)
    assert status == "already"
    assert new is None


def test_patch_unrecognized_structure():
    new, status = mod.patch_hook_content("#!/bin/sh\necho hello\n")
    assert status == "unrecognized"
    assert new is None


def test_patch_handles_crlf_input():
    crlf = _generated_hook().replace("\n", "\r\n")
    new, status = mod.patch_hook_content(crlf)
    assert status == "patched"
    assert "logs/pre-commit-errors.log" in new


def test_only_pre_commit_stage_is_installed():
    # No hooks use the pre-push stage anymore (CI owns the slow checks); the
    # installer must not create a pre-push hook, and must clean up the one an
    # earlier install left behind.
    assert [p.name for p in mod.HOOK_FILES] == ["pre-commit"]
    assert [p.name for p in mod.STALE_HOOK_FILES] == ["pre-push"]


def test_remove_stale_hooks_deletes_existing(tmp_path):
    stale = tmp_path / "pre-push"
    stale.write_text("#!/bin/sh\n", encoding="utf-8")
    assert mod.remove_stale_hooks([stale]) == ["pre-push"]
    assert not stale.exists()


def test_remove_stale_hooks_noop_when_missing(tmp_path):
    assert mod.remove_stale_hooks([tmp_path / "pre-push"]) == []
