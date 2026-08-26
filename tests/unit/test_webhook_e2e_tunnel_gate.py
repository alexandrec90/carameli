"""Unit coverage for the ngrok reachability gate in ``tests/integration/test_webhook_e2e.py``.

The five webhook tests are collected by the free changed-scope, and NGROK_URL being
*set* was the only thing gating them. The domain is reserved, so an ephemeral worktree
box -- which seeds its ``.env`` from the source checkout -- inherits a URL that resolves
whether or not a tunnel is up; with none up, ngrok answers 404 and all five failed on
every branch, for a reason no branch caused. That made the pre-stop gate unpassable
from a box.

The gate has to fix that without going soft on the run whose entire purpose IS
reachability, hence the two directions asserted below.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "tests" / "integration" / "test_webhook_e2e.py"


def _load_module() -> Any:
    """Import the integration module for inspection, without collecting its tests."""
    spec = importlib.util.spec_from_file_location("webhook_e2e_under_test", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


webhook_e2e = _load_module()

_URL = "https://example.ngrok.app"


def _response(status: int, url: str) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("GET", url))


@pytest.fixture(autouse=True)
def _clear_probe_cache():
    """The probe is `functools.cache`d for the session; each test needs its own answer."""
    webhook_e2e.tunnel_serves_a_stack.cache_clear()
    yield
    webhook_e2e.tunnel_serves_a_stack.cache_clear()


class TestTunnelProbe:
    def test_a_serving_tunnel_is_reachable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(httpx, "get", lambda url, timeout: _response(200, url))
        assert webhook_e2e.tunnel_serves_a_stack(_URL) is True

    def test_ngroks_own_404_is_not_a_serving_tunnel(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The exact shape of the defect: the domain resolves, nothing is behind it."""
        monkeypatch.setattr(httpx, "get", lambda url, timeout: _response(404, url))
        assert webhook_e2e.tunnel_serves_a_stack(_URL) is False

    def test_a_transport_error_is_not_a_serving_tunnel(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _boom(url: str, timeout: float) -> httpx.Response:
            raise httpx.ConnectError("nothing listening")

        monkeypatch.setattr(httpx, "get", _boom)
        assert webhook_e2e.tunnel_serves_a_stack(_URL) is False

    def test_the_probe_hits_health_once(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[str] = []

        def _record(url: str, timeout: float) -> httpx.Response:
            calls.append(url)
            return _response(200, url)

        monkeypatch.setattr(httpx, "get", _record)
        webhook_e2e.tunnel_serves_a_stack(_URL)
        webhook_e2e.tunnel_serves_a_stack(_URL)

        assert calls == [f"{_URL}/health"]


class TestTunnelGate:
    def _probe(self, monkeypatch: pytest.MonkeyPatch, *, up: bool) -> None:
        """Drive the gate through the real probe rather than replacing it.

        Substituting `tunnel_serves_a_stack` itself would leave a plain function in
        the module for the duration of `_clear_probe_cache`'s teardown -- pytest sets
        `monkeypatch` up before that autouse fixture, so it is undone after it.
        """
        status = 200 if up else 404
        monkeypatch.setattr(httpx, "get", lambda url, timeout: _response(status, url))

    def test_a_live_tunnel_lets_the_test_run(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._probe(monkeypatch, up=True)
        assert webhook_e2e.tunnel_gate(_URL, False) is None

    def test_a_dead_tunnel_skips_the_free_scope(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._probe(monkeypatch, up=False)
        with pytest.raises(pytest.skip.Exception):
            webhook_e2e.tunnel_gate(_URL, False)

    def test_a_dead_tunnel_fails_the_dedicated_run(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """``--target webhook-e2e`` exists to answer "is it reachable?" -- a skip there
        is the all-skipped green pass ``_CRITICAL_TARGETS`` was added to prevent."""
        self._probe(monkeypatch, up=False)
        with pytest.raises(pytest.fail.Exception):
            webhook_e2e.tunnel_gate(_URL, True)

    def test_the_message_names_the_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._probe(monkeypatch, up=False)
        with pytest.raises(pytest.fail.Exception) as excinfo:
            webhook_e2e.tunnel_gate("https://reserved.ngrok.app", True)
        assert "https://reserved.ngrok.app" in str(excinfo.value)
