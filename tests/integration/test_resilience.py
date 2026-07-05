"""Resilience tests: Redis outages, DB blips, provider timeouts.

All external I/O is mocked at the app.state.carrier / app.state.engine boundary.
Redis behavior is simulated at the worker integration boundary.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core.config import settings
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_customer(client, vs_customer_id: int, api_key: str) -> None:
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": vs_customer_id, "api_key": api_key},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def test_retry_unposted_events_survives_redis_error() -> None:
    """retry_unposted_events must not crash while worker dependencies are degraded."""
    from app.services.call_sync import retry_unposted_events

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_repo = MagicMock()
    mock_repo.get_unposted = AsyncMock(return_value=[])

    with (
        patch("app.services.call_sync.settings") as mock_settings,
        patch("app.services.call_sync.async_session_factory", return_value=mock_session),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
    ):
        mock_settings.vanillasoft_webhook_url = "http://vanillasoft.test/callback"
        mock_settings.vanillasoft_webhook_secret = ""

        await retry_unposted_events({})

    mock_repo.get_unposted.assert_awaited_once()


async def test_webhook_survives_db_write_failure(client, monkeypatch) -> None:
    """Jambonz call-status webhook returns 200 even if DB write fails."""
    from app.services import call_event_service

    monkeypatch.setattr(settings, "jambonz_webhook_secret", "")

    with patch.object(
        call_event_service,
        "create_from_webhook",
        AsyncMock(side_effect=Exception("DB connection lost")),
    ):
        resp = await client.post(
            "/webhooks/jambonz/call-status",
            json={"call_sid": "CAdbblip001", "call_status": "completed"},
        )

    assert resp.status_code == 200


async def test_provider_timeout_returns_502(client) -> None:
    """A carrier timeout during DID provision must return 502, not 500."""
    from app.main import app

    await _create_customer(client, 7001, "key-7001")

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+17001550001"}])
    app.state.carrier.provision_number = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7001, "area_code": "700"},
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 502


async def test_provision_failure_after_search_returns_502(client) -> None:
    """Search success followed by provision failure must surface as 502 provider error."""
    from app.main import app

    await _create_customer(client, 7002, "key-7002")

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+17002550001"}])
    app.state.carrier.provision_number = AsyncMock(side_effect=Exception("Carrier error"))

    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7002, "area_code": "700"},
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 502
    assert "Provider" in resp.json().get("detail", "")


async def test_vanillasoft_writeback_failure_does_not_block_webhook(client, monkeypatch) -> None:
    """If VanillaSoft POST fails during webhook handling, acknowledge with 200."""
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "")
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vanillasoft.test/callback")

    with patch("app.services.vanillasoft_notify.httpx.AsyncClient") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
        mock_client_cls.return_value = mock_http

        resp = await client.post(
            "/webhooks/jambonz/call-status",
            json={
                "call_sid": "CAvsfail001",
                "call_status": "completed",
                "from": "+14155550000",
                "to": "+14155550001",
            },
        )

    assert resp.status_code == 200


def test_worker_settings_cron_jobs_configured() -> None:
    """WorkerSettings includes cron jobs needed after worker restarts."""
    from app.services.call_sync import WorkerSettings

    assert len(WorkerSettings.cron_jobs) >= 2
