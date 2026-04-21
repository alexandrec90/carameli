from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.call_sync import _vanillasoft_headers, retry_unposted_events

pytestmark = pytest.mark.asyncio(loop_scope="session")


# ─────────────────────────────────────────────────────────────────────────────
# _vanillasoft_headers
# ─────────────────────────────────────────────────────────────────────────────


def test_vanillasoft_headers_no_secret_returns_empty(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    assert _vanillasoft_headers() == {}


def test_vanillasoft_headers_with_secret_returns_bearer(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", "mysecret")
    assert _vanillasoft_headers() == {"Authorization": "Bearer mysecret"}


_CTX: dict = {}


def _make_event(
    call_sid: str = "CA001",
    status: str = "completed",
    customer_id: uuid.UUID | None = None,
) -> MagicMock:
    event = MagicMock()
    event.id = uuid.uuid4()
    event.call_sid = call_sid
    event.status = status
    event.customer_id = customer_id
    event.from_number = "+15550000001"
    event.to_number = "+15550000002"
    event.extension = "101"
    event.duration_seconds = 42
    event.recording_url = None
    event.started_at = None
    event.ended_at = None
    return event


async def test_retry_skips_when_no_webhook_url() -> None:
    """Early return when VANILLASOFT_WEBHOOK_URL is not configured."""
    with patch("app.services.call_sync.settings") as mock_settings:
        mock_settings.vanillasoft_webhook_url = None
        with patch("app.services.call_sync.async_session_factory") as mock_factory:
            await retry_unposted_events(_CTX)
            mock_factory.assert_not_called()


async def test_retry_skips_when_no_unposted_events() -> None:
    """No HTTP calls made when get_unposted returns empty list."""
    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = []

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.services.call_sync.settings") as mock_settings,
        patch("app.services.call_sync.async_session_factory", return_value=mock_session),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
    ):
        mock_settings.vanillasoft_webhook_url = "http://vs.example.com/webhook"
        mock_settings.vanillasoft_webhook_secret = ""

        await retry_unposted_events(_CTX)

        mock_repo.get_unposted.assert_awaited_once()
        mock_repo.mark_posted.assert_not_awaited()


async def test_retry_posts_terminal_event_and_marks_posted() -> None:
    """A completed event is POSTed to VanillaSoft and marked as posted on success."""
    event = _make_event(status="completed")

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]

    mock_customer_repo = AsyncMock()
    mock_customer_repo.get_by_id.return_value = None

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_response = MagicMock()
    mock_response.is_success = True

    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)
    mock_http.post = AsyncMock(return_value=mock_response)

    with (
        patch("app.services.call_sync.settings") as mock_settings,
        patch("app.services.call_sync.async_session_factory", return_value=mock_session),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.CustomerRepo", return_value=mock_customer_repo),
        patch("app.services.call_sync.httpx.AsyncClient", return_value=mock_http),
    ):
        mock_settings.vanillasoft_webhook_url = "http://vs.example.com/webhook"
        mock_settings.vanillasoft_webhook_secret = "secret"

        await retry_unposted_events(_CTX)

        mock_http.post.assert_awaited_once()
        mock_repo.mark_posted.assert_awaited_once_with(event.id)


@pytest.mark.parametrize("status", ["no-answer", "busy", "failed", "canceled"])
async def test_retry_posts_all_terminal_statuses(status: str) -> None:
    """All terminal statuses trigger a VanillaSoft POST."""
    event = _make_event(status=status)

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]

    mock_customer_repo = AsyncMock()
    mock_customer_repo.get_by_id.return_value = None

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_response = MagicMock()
    mock_response.is_success = True

    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)
    mock_http.post = AsyncMock(return_value=mock_response)

    with (
        patch("app.services.call_sync.settings") as mock_settings,
        patch("app.services.call_sync.async_session_factory", return_value=mock_session),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.CustomerRepo", return_value=mock_customer_repo),
        patch("app.services.call_sync.httpx.AsyncClient", return_value=mock_http),
    ):
        mock_settings.vanillasoft_webhook_url = "http://vs.example.com/webhook"
        mock_settings.vanillasoft_webhook_secret = ""

        await retry_unposted_events(_CTX)

        mock_http.post.assert_awaited_once()
        mock_repo.mark_posted.assert_awaited_once_with(event.id)


async def test_retry_skips_non_terminal_status() -> None:
    """Events with non-terminal status (e.g. 'in-progress') are not POSTed."""
    event = _make_event(status="in-progress")

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.services.call_sync.settings") as mock_settings,
        patch("app.services.call_sync.async_session_factory", return_value=mock_session),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.httpx.AsyncClient") as mock_http_cls,
    ):
        mock_settings.vanillasoft_webhook_url = "http://vs.example.com/webhook"
        mock_settings.vanillasoft_webhook_secret = ""

        await retry_unposted_events(_CTX)

        mock_http_cls.assert_not_called()
        mock_repo.mark_posted.assert_not_awaited()


async def test_retry_warns_on_non_2xx_and_does_not_mark_posted() -> None:
    """A non-2xx response logs a warning and does not mark the event as posted."""
    event = _make_event(status="completed")

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]

    mock_customer_repo = AsyncMock()
    mock_customer_repo.get_by_id.return_value = None

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 503

    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)
    mock_http.post = AsyncMock(return_value=mock_response)

    with (
        patch("app.services.call_sync.settings") as mock_settings,
        patch("app.services.call_sync.async_session_factory", return_value=mock_session),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.CustomerRepo", return_value=mock_customer_repo),
        patch("app.services.call_sync.httpx.AsyncClient", return_value=mock_http),
    ):
        mock_settings.vanillasoft_webhook_url = "http://vs.example.com/webhook"
        mock_settings.vanillasoft_webhook_secret = ""

        await retry_unposted_events(_CTX)

        mock_http.post.assert_awaited_once()
        mock_repo.mark_posted.assert_not_awaited()
