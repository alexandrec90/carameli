from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.services.call_sync import retry_unposted_events

pytestmark = pytest.mark.asyncio(loop_scope="session")

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
    event.direction = "outbound"
    event.from_number = "+15550000001"
    event.to_number = "+15550000002"
    event.extension = "101"
    event.duration_seconds = 42
    event.recording_url = None
    event.started_at = None
    event.ended_at = None
    return event


def _mock_http(is_success: bool = True, status_code: int = 200) -> AsyncMock:
    mock_response = MagicMock()
    mock_response.is_success = is_success
    mock_response.status_code = status_code
    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)
    mock_http.post = AsyncMock(return_value=mock_response)
    return mock_http


def _mock_session() -> AsyncMock:
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    return mock_session


async def test_retry_skips_when_no_webhook_url(monkeypatch) -> None:
    """Early return when VANILLASOFT_WEBHOOK_URL is not configured."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", None)
    with patch("app.services.call_sync.async_session_factory") as mock_factory:
        await retry_unposted_events(_CTX)
        mock_factory.assert_not_called()


async def test_retry_skips_when_no_unposted_events(monkeypatch) -> None:
    """No HTTP calls made when get_unposted returns empty list."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = []

    with (
        patch("app.services.call_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
    ):
        await retry_unposted_events(_CTX)

        mock_repo.get_unposted.assert_awaited_once()
        mock_repo.mark_posted.assert_not_awaited()


async def test_retry_posts_incoming_call_contract_and_marks_posted(monkeypatch) -> None:
    """A completed event is POSTed as the IncomingCall shape with X-Cloudli-Auth."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", "cloudli-secret")
    event = _make_event(status="completed")

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]
    mock_customer_repo = AsyncMock()
    mock_customer_repo.get_by_id.return_value = None
    mock_http = _mock_http()

    with (
        patch("app.services.call_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.CustomerRepo", return_value=mock_customer_repo),
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=mock_http),
    ):
        await retry_unposted_events(_CTX)

    mock_http.post.assert_awaited_once()
    call = mock_http.post.call_args
    assert call.args[0] == "http://vs.example.com/cloudliapi/notify/IncomingCall"
    assert call.kwargs["headers"] == {"X-Cloudli-Auth": "cloudli-secret"}
    payload = call.kwargs["json"]
    assert payload["callId"] == "CA001"
    assert payload["eventName"] == "callHungup"
    assert payload["isInbound"] is False
    mock_repo.mark_posted.assert_awaited_once_with(event.id)


@pytest.mark.parametrize("status", ["no-answer", "busy", "failed", "canceled"])
async def test_retry_posts_all_terminal_statuses(monkeypatch, status: str) -> None:
    """All terminal statuses trigger a VanillaSoft POST (mapped to callHungup)."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    event = _make_event(status=status)

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]
    mock_customer_repo = AsyncMock()
    mock_customer_repo.get_by_id.return_value = None
    mock_http = _mock_http()

    with (
        patch("app.services.call_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.CustomerRepo", return_value=mock_customer_repo),
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=mock_http),
    ):
        await retry_unposted_events(_CTX)

    mock_http.post.assert_awaited_once()
    assert mock_http.post.call_args.kwargs["json"]["eventName"] == "callHungup"
    mock_repo.mark_posted.assert_awaited_once_with(event.id)


async def test_retry_skips_non_terminal_status(monkeypatch) -> None:
    """Events with non-terminal status (e.g. 'in-progress') are not POSTed."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    event = _make_event(status="in-progress")

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]

    with (
        patch("app.services.call_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.vanillasoft_notify.httpx.AsyncClient") as mock_http_cls,
    ):
        await retry_unposted_events(_CTX)

        mock_http_cls.assert_not_called()
        mock_repo.mark_posted.assert_not_awaited()


async def test_retry_warns_on_non_2xx_and_does_not_mark_posted(monkeypatch) -> None:
    """A non-2xx response does not mark the event as posted."""
    monkeypatch.setattr(settings, "vanillasoft_webhook_url", "http://vs.example.com/cloudliapi")
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    event = _make_event(status="completed")

    mock_repo = AsyncMock()
    mock_repo.get_unposted.return_value = [event]
    mock_customer_repo = AsyncMock()
    mock_customer_repo.get_by_id.return_value = None
    mock_http = _mock_http(is_success=False, status_code=503)

    with (
        patch("app.services.call_sync.async_session_factory", return_value=_mock_session()),
        patch("app.services.call_sync.CallEventRepo", return_value=mock_repo),
        patch("app.services.call_sync.CustomerRepo", return_value=mock_customer_repo),
        patch("app.services.vanillasoft_notify.httpx.AsyncClient", return_value=mock_http),
    ):
        await retry_unposted_events(_CTX)

    mock_http.post.assert_awaited_once()
    mock_repo.mark_posted.assert_not_awaited()
