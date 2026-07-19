from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core.config import settings
from app.core.heartbeat import ping

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _mock_http() -> AsyncMock:
    response = MagicMock()
    response.raise_for_status.return_value = None
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.get = AsyncMock(return_value=response)
    return client


async def test_ping_noops_when_url_is_empty(monkeypatch) -> None:
    monkeypatch.setattr(settings, "heartbeat_url", "")

    with patch("app.core.heartbeat.httpx.AsyncClient") as client_class:
        await ping("test-job")

    client_class.assert_not_called()


async def test_ping_appends_slug_and_uses_short_timeout(monkeypatch) -> None:
    monkeypatch.setattr(settings, "heartbeat_url", "https://heartbeat.example/push/")
    client = _mock_http()

    with patch("app.core.heartbeat.httpx.AsyncClient", return_value=client) as client_class:
        await ping("daily backup")

    client_class.assert_called_once_with(timeout=3.0)
    client.get.assert_awaited_once_with("https://heartbeat.example/push/daily%20backup")
    client.get.return_value.raise_for_status.assert_called_once_with()


async def test_ping_swallows_connection_errors(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "heartbeat_url", "https://heartbeat.example/push")
    client = _mock_http()
    client.get.side_effect = httpx.ConnectError("offline")

    with (
        patch("app.core.heartbeat.httpx.AsyncClient", return_value=client),
        caplog.at_level("WARNING", logger="app.core.heartbeat"),
    ):
        await ping("test-job")

    assert "Heartbeat ping failed slug=test-job" in caplog.text
    assert "heartbeat.example" not in caplog.text
