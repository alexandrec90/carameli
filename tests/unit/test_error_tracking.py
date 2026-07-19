from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from sentry_sdk.integrations.arq import ArqIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

from app.core.config import settings
from app.core.error_tracking import init_error_tracking

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_init_error_tracking_returns_false_when_dsn_is_empty(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(settings, "sentry_dsn", "")

    with (
        caplog.at_level(logging.INFO, logger="app.core.error_tracking"),
        patch("app.core.error_tracking.sentry_sdk.init") as mock_init,
    ):
        enabled = init_error_tracking()

    assert enabled is False
    mock_init.assert_not_called()
    assert "error tracking disabled" in caplog.messages


async def test_init_error_tracking_passes_configured_settings(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dsn = "https://public@example.invalid/1"
    monkeypatch.setattr(settings, "sentry_dsn", dsn)
    monkeypatch.setattr(settings, "sentry_environment", "staging")
    monkeypatch.setattr(settings, "sentry_traces_sample_rate", 0.25)

    with (
        caplog.at_level(logging.INFO, logger="app.core.error_tracking"),
        patch("app.core.error_tracking.sentry_sdk.init") as mock_init,
    ):
        enabled = init_error_tracking()

    assert enabled is True
    mock_init.assert_called_once()
    kwargs = mock_init.call_args.kwargs
    assert kwargs["dsn"] == dsn
    assert kwargs["environment"] == "staging"
    assert kwargs["traces_sample_rate"] == 0.25
    assert any(
        isinstance(integration, FastApiIntegration) for integration in kwargs["integrations"]
    )
    assert any(isinstance(integration, ArqIntegration) for integration in kwargs["integrations"])
    assert "send_default_pii" not in kwargs
    assert "error tracking enabled environment=staging" in caplog.messages
    assert all(dsn not in message for message in caplog.messages)


async def test_fastapi_lifespan_boots_without_error_tracking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.main import lifespan

    monkeypatch.setattr(settings, "sentry_dsn", "")
    test_app = FastAPI()
    fake_carrier = MagicMock()
    fake_engine = MagicMock()

    with (
        patch("app.core.error_tracking.sentry_sdk.init") as mock_sentry_init,
        patch("app.main.get_carrier_provider", return_value=fake_carrier),
        patch("app.main.get_call_engine_provider", return_value=fake_engine),
    ):
        async with lifespan(test_app):
            assert test_app.state.carrier is fake_carrier
            assert test_app.state.engine is fake_engine

    mock_sentry_init.assert_not_called()
