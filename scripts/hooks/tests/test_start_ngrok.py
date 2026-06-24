"""Tests for scripts/start-ngrok.py pure helpers."""
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
    payload = {"tunnels": [
        {"proto": "http", "public_url": "http://x"},
        {"proto": "https", "public_url": "https://x"},
    ]}
    assert mod.extract_https_url(payload) == "https://x"


def test_extract_https_url_none_when_absent():
    assert mod.extract_https_url({"tunnels": [{"proto": "http", "public_url": "http://x"}]}) is None
    assert mod.extract_https_url({}) is None
