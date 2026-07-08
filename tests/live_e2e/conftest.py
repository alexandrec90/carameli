"""Fixtures for the live E2E suite — deliberately DB-free.

This suite observes the *live running stack* from the outside, so it must NOT import
the savepoint-isolation DB fixtures from ``tests/conftest.py`` (those wrap a throwaway
*test* database). It gets its own tiny fixtures instead: config from the environment,
a thin authed httpx client, and a log-tail capture. See ``helpers.py`` for the env
contract.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from app.core.config import settings
from tests.live_e2e.helpers import CarameliClient, E2EConfig, LogCapture, LogTail


@pytest.fixture
def live_config() -> E2EConfig:
    """Resolve the live config from the environment, skipping if it's incomplete."""
    cfg = E2EConfig.from_env()
    if cfg is None:
        pytest.skip("E2E_* environment not fully configured")
    return cfg


@pytest_asyncio.fixture
async def live_client(live_config: E2EConfig) -> AsyncIterator[CarameliClient]:
    """An authed HTTP client for Carameli's public API, closed after the test."""
    client = CarameliClient(live_config.base_url, live_config.api_key)
    try:
        yield client
    finally:
        await client.aclose()


@pytest.fixture
def log_capture() -> LogCapture:
    """Capture new ``carameli.log`` content from 'now' — same machine as the stack."""
    return LogCapture(LogTail.at_end(settings.log_file))
