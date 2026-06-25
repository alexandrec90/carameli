"""Tests for scripts/install-pre-commit.py pure patch_hook_content."""

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
