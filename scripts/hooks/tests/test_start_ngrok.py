"""Tests for scripts/start-ngrok.py pure helpers."""

from types import SimpleNamespace

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
    assert mod.extract_https_url({"tunnels": [{"proto": "https", "public_url": None}]}) is None
    assert mod.extract_https_url({}) is None


def test_get_env_value_reads_file(monkeypatch):
    monkeypatch.delenv("TELNYX_API_KEY", raising=False)
    content = "A=1\nTELNYX_API_KEY=from-file\nB=2\n"
    assert mod.get_env_value(content, "TELNYX_API_KEY") == "from-file"


def test_get_env_value_env_overrides_file(monkeypatch):
    monkeypatch.setenv("TELNYX_API_KEY", "from-environment")
    content = "TELNYX_API_KEY=from-file\n"
    assert mod.get_env_value(content, "TELNYX_API_KEY") == "from-environment"


def test_get_env_value_blank_when_missing(monkeypatch):
    monkeypatch.delenv("TELNYX_API_KEY", raising=False)
    assert mod.get_env_value("A=1\n", "TELNYX_API_KEY") == ""


def test_build_ngrok_args_uses_assigned_dev_domain():
    assert mod.build_ngrok_args() == ["ngrok", "http", "8000"]


def test_build_compose_recreate_args_reloads_app_and_worker_without_dependencies():
    assert mod.build_compose_recreate_args() == [
        "docker",
        "compose",
        "up",
        "-d",
        "--force-recreate",
        "--no-deps",
        "app",
        "worker",
    ]


def test_build_webhook_test_args_disables_tty_and_passes_tunnel_url():
    assert mod.build_webhook_test_args("https://carameli.ngrok-free.app") == [
        "docker",
        "compose",
        "exec",
        "-T",
        "-e",
        "NGROK_URL=https://carameli.ngrok-free.app",
        "app",
        "pytest",
        "tests/integration/test_webhook_e2e.py",
        "-v",
    ]


def test_sync_public_urls_sets_every_consumer():
    content, results = mod.sync_public_urls("A=1\n", "https://carameli.ngrok-free.app")

    assert [key for key, _ in results] == mod.PUBLIC_URL_KEYS
    assert all(not existed for _, existed in results)
    for key in mod.PUBLIC_URL_KEYS:
        assert f"{key}=https://carameli.ngrok-free.app" in content


def test_ensure_repo_root_importable_prepends_missing_path(tmp_path, monkeypatch):
    repo_root = str(tmp_path)
    monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(mod.sys, "path", [entry for entry in mod.sys.path if entry != repo_root])

    mod.ensure_repo_root_importable()

    assert mod.sys.path[0] == repo_root


@pytest.mark.parametrize(
    ("api_key", "profile_id"),
    [("", "MP1"), ("key", ""), ("", "")],
)
def test_push_webhook_to_telnyx_skips_without_credentials(api_key, profile_id):
    # Returns None (no API call) when either credential is absent — the missing-cred
    # branch returns before importing the app package, so this needs no app on path.
    assert mod.push_webhook_to_telnyx("https://x.ngrok-free.app", api_key, profile_id) is None


@pytest.mark.parametrize(
    ("telnyx_error", "compose_code", "expected_code"),
    [(False, 0, 0), (True, 0, 1), (False, 7, 7)],
)
def test_main_syncs_urls_recreates_services_and_propagates_failures(
    tmp_path, monkeypatch, telnyx_error, compose_code, expected_code
):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "TELNYX_API_KEY=test-key\nTELNYX_MESSAGING_PROFILE_ID=MP123\n",  # pragma: allowlist secret
        encoding="utf-8",
    )
    tunnel_url = "https://carameli.ngrok-free.app"
    run_calls = []
    telnyx_calls = []

    def fake_run(args, **kwargs):
        run_calls.append((args, kwargs))
        return SimpleNamespace(returncode=compose_code if args[0] == "docker" else 0)

    def fake_push(base_url, api_key, profile_id):
        telnyx_calls.append((base_url, api_key, profile_id))
        if telnyx_error:
            raise RuntimeError("Telnyx unavailable")
        return f"{base_url}/webhooks/telnyx/sms-inbound"

    monkeypatch.delenv("TELNYX_API_KEY", raising=False)
    monkeypatch.delenv("TELNYX_MESSAGING_PROFILE_ID", raising=False)
    monkeypatch.setattr(mod, "ENV_FILE", env_file)
    monkeypatch.setattr(mod.time, "sleep", lambda _: None)
    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    monkeypatch.setattr(mod.subprocess, "Popen", lambda *args, **kwargs: None)
    monkeypatch.setattr(mod, "poll_tunnel_url", lambda: tunnel_url)
    monkeypatch.setattr(mod, "push_webhook_to_telnyx", fake_push)

    assert mod.main() == expected_code
    content = env_file.read_text(encoding="utf-8")
    for key in mod.PUBLIC_URL_KEYS:
        assert f"{key}={tunnel_url}" in content
    assert telnyx_calls == [(tunnel_url, "test-key", "MP123")]
    assert run_calls[-1][0] == mod.build_compose_recreate_args()
