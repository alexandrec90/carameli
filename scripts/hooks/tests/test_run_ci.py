"""Tests for scripts/run-ci.py stage definitions and reachability check."""

from conftest import load_module

mod = load_module("scripts/run-ci.py")


def test_backend_stage_uses_dash_t_flag():
    # docker compose exec must use -T (tooling rule).
    assert "-T" in mod._BACKEND_ARGV
    assert mod._BACKEND_ARGV[:4] == ["docker", "compose", "exec", "-T"]


def test_e2e_stage_targets_smoke():
    assert "tests/e2e/test_smoke.py" in mod._E2E_ARGV


def test_frontend_reachable_false_on_oserror(monkeypatch):
    def boom(*a, **k):
        raise OSError("refused")

    monkeypatch.setattr(mod.urllib.request, "urlopen", boom)
    assert mod.frontend_reachable("http://localhost:1") is False
