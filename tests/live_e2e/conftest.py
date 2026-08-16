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
from tests.live_e2e.helpers import (
    CarameliClient,
    E2EConfig,
    LogCapture,
    LogTail,
    PubApiClient,
)


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


@pytest_asyncio.fixture
async def pubapi_client(live_config: E2EConfig) -> AsyncIterator[PubApiClient | None]:
    """A VanillaSoft PubApi client when ``E2E_VS_CHECK=1``, else ``None``.

    ``None`` is the "VS check not requested" signal a test branches on. It is never the
    "requested but unusable" signal: ``live_e2e_skip_reason`` already refuses to run the
    suite when the flag is set without PubApi credentials, and the guard below repeats
    that as a named skip rather than letting the check degrade into a no-op.
    """
    if not live_config.vs_check:
        yield None
        return
    if not (live_config.pubapi_base_url and live_config.pubapi_key):
        pytest.skip("E2E_VS_CHECK=1 needs E2E_PUBAPI_BASE_URL and E2E_PUBAPI_KEY")
    client = PubApiClient(live_config.pubapi_base_url, live_config.pubapi_key)
    try:
        yield client
    finally:
        await client.aclose()


@pytest.fixture
def log_capture() -> LogCapture:
    """Capture new ``carameli.log`` content from 'now' — same machine as the stack."""
    return LogCapture(LogTail.at_end(settings.log_file))
