"""Tests for scripts/start-ngrok.py pure helpers."""

import pytest
from conftest import load_module

mod = load_module("scripts/start-ngrok.py")


def test_set_env_var_updates_existing():
    content = "A=1\nNGROK_URL=old\nB=2\n"
    out, updated = mod.set_env_var(content, "NGROK_URL", "https://new")
    assert updated is True
    assert "NGROK_URL=https://new" in out
    assert "NGROK_URL=old" not in out
    assert "A=1" in out and "B=2" in out


def test_set_env_var_appends_when_missing():
    content = "A=1\n"
    out, updated = mod.set_env_var(content, "NGROK_URL", "https://new")
    assert updated is False
    assert out.endswith("NGROK_URL=https://new\n")
    assert "A=1" in out


def test_extract_https_url_picks_https():
    payload = {
        "tunnels": [
            {"proto": "http", "public_url": "http://x"},
            {"proto": "https", "public_url": "https://x"},
        ]
    }
    assert mod.extract_https_url(payload) == "https://x"


def test_extract_https_url_none_when_absent():
    assert mod.extract_https_url({"tunnels": [{"proto": "http", "public_url": "http://x"}]}) is None
    assert mod.extract_https_url({}) is None


def test_get_env_value_reads_file(monkeypatch):
    monkeypatch.delenv("NGROK_DOMAIN", raising=False)
    content = "A=1\nNGROK_DOMAIN=abc123.ngrok-free.dev\nB=2\n"
    assert mod.get_env_value(content, "NGROK_DOMAIN") == "abc123.ngrok-free.dev"


def test_get_env_value_env_overrides_file(monkeypatch):
    monkeypatch.setenv("NGROK_DOMAIN", "override.ngrok-free.dev")
    content = "NGROK_DOMAIN=fromfile.ngrok-free.dev\n"
    assert mod.get_env_value(content, "NGROK_DOMAIN") == "override.ngrok-free.dev"


def test_get_env_value_blank_when_missing(monkeypatch):
    monkeypatch.delenv("NGROK_DOMAIN", raising=False)
    assert mod.get_env_value("A=1\n", "NGROK_DOMAIN") == ""


def test_build_ngrok_args_without_domain():
    assert mod.build_ngrok_args() == ["ngrok", "http", "8000"]


def test_build_ngrok_args_with_domain():
    assert mod.build_ngrok_args("abc123.ngrok-free.dev") == [
        "ngrok",
        "http",
        "8000",
        "--domain=abc123.ngrok-free.dev",
    ]


@pytest.mark.parametrize(
    ("api_key", "profile_id"),
    [("", "MP1"), ("key", ""), ("", "")],
)
def test_push_webhook_to_telnyx_skips_without_credentials(api_key, profile_id):
    # Returns None (no API call) when either credential is absent — the missing-cred
    # branch returns before importing the app package, so this needs no app on path.
    assert mod.push_webhook_to_telnyx("https://x.ngrok-free.dev", api_key, profile_id) is None
