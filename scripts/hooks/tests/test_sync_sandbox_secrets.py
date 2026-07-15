"""Tests for scripts/sync-sandbox-secrets.py — the .env -> GitHub `sandbox`
environment reconciler. Only the pure logic (dotenv parse + sync plan) is
covered; the `gh` subprocess calls are exercised manually, not here."""

from conftest import load_module

mod = load_module("scripts/sync-sandbox-secrets.py")


def test_parse_dotenv_basic_and_quotes_and_comments():
    text = "\n".join(
        [
            "# a comment",
            "",
            "TELNYX_API_KEY=abc123",
            'TELNYX_WEBHOOK_SECRET="wh secret"',  # pragma: allowlist secret
            "TELNYX_TEST_FROM_NUMBER='+15551234567'",
            "export TELNYX_TEST_TO_NUMBER=+15559999999",
            "MALFORMED_LINE_NO_EQUALS",
            "TELNYX_WEBHOOK_BASE_URL=https://x.ngrok-free.app",
        ]
    )
    values = mod.parse_dotenv(text)
    assert values["TELNYX_API_KEY"] == "abc123"  # pragma: allowlist secret
    assert (
        values["TELNYX_WEBHOOK_SECRET"] == "wh secret"
    )  # quotes stripped  # pragma: allowlist secret
    assert values["TELNYX_TEST_FROM_NUMBER"] == "+15551234567"  # single quotes
    assert values["TELNYX_TEST_TO_NUMBER"] == "+15559999999"  # export prefix
    assert values["TELNYX_WEBHOOK_BASE_URL"] == "https://x.ngrok-free.app"
    assert "MALFORMED_LINE_NO_EQUALS" not in values


def test_parse_dotenv_keeps_empty_values_distinct_from_missing():
    values = mod.parse_dotenv("TELNYX_API_KEY=\n")
    assert values["TELNYX_API_KEY"] == ""


def test_plan_sync_routes_secrets_and_vars():
    values = {
        "TELNYX_API_KEY": "k",
        "TELNYX_WEBHOOK_BASE_URL": "https://x",
    }
    secrets, variables, _skipped = mod.plan_sync(values)
    assert "TELNYX_API_KEY" in secrets
    assert "TELNYX_WEBHOOK_BASE_URL" in variables
    # The base URL is a variable, never a secret.
    assert "TELNYX_WEBHOOK_BASE_URL" not in secrets


def test_plan_sync_skips_empty_and_missing_with_reason():
    values = {"TELNYX_API_KEY": "", "TELNYX_TEST_FROM_NUMBER": "+1555"}
    secrets, _variables, skipped = mod.plan_sync(values)
    reasons = dict(skipped)
    # Empty -> skipped as "empty" so a blank never clobbers a stored secret.
    assert reasons["TELNYX_API_KEY"] == "empty"  # pragma: allowlist secret
    # Absent from .env -> "missing".
    assert reasons["TELNYX_WEBHOOK_SECRET"] == "missing"  # pragma: allowlist secret
    # Present and non-empty -> not skipped.
    assert "TELNYX_TEST_FROM_NUMBER" in secrets
    assert "TELNYX_TEST_FROM_NUMBER" not in reasons


def test_secret_and_var_key_sets_are_disjoint():
    # A key routed as both a secret and a variable would double-write and leak a
    # secret's value into a plaintext variable.
    assert not (set(mod.SECRET_KEYS) & set(mod.VAR_KEYS))
