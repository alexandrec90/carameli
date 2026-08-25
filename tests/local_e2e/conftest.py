"""Fixtures for the local integration suite — deliberately app-free and DB-free.

This suite runs on the **LegacyCRM** machine, where Carameli's Python stack is not
installed: no Postgres, no Redis, no ``app`` package. It therefore imports nothing from
``app.*`` and none of the shared DB fixtures in ``tests/conftest.py`` (those wrap a
throwaway test database that does not exist here). Config comes from the environment; see
``helpers.py`` for the contract.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from tests.local_e2e.helpers import CarameliApi, LocalE2EConfig, load_dotenv, local_e2e_skip_reason

# Repo root: tests/local_e2e/conftest.py -> tests/local_e2e -> tests -> repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]


def pytest_configure(config: pytest.Config) -> None:
    """Load ``.env.local-e2e`` before the skip gate reads the environment.

    The file is git-ignored and holds the tunnel URLs and shared secrets for one
    machine's setup, so it must not be committed and must not be required — real env
    vars still win and the suite skips cleanly when neither is present.
    """
    load_dotenv(REPO_ROOT / ".env.local-e2e")


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Mark every test in this directory ``local_e2e`` and skip when unconfigured.

    Applying the marker here rather than per-module means a new test file cannot
    accidentally escape the gate and run against real infrastructure by default.
    """
    reason = local_e2e_skip_reason()
    for item in items:
        item.add_marker(pytest.mark.local_e2e)
        if reason:
            item.add_marker(pytest.mark.skip(reason=reason))


@pytest.fixture(scope="session")
def config() -> LocalE2EConfig:
    """Resolved environment config, skipping the test when it is incomplete."""
    resolved = LocalE2EConfig.from_env()
    if resolved is None:
        pytest.skip("local E2E environment not fully configured")
    return resolved


@pytest.fixture(scope="session")
def public_vs_base_url(config: LocalE2EConfig) -> str:
    """The tunnel that exposes local IIS, skipping tests that require it.

    Without this, remote Carameli physically cannot deliver a notify to the local
    receiver, so the reverse-direction tests are not failing — they are not applicable.
    """
    if not config.vs_public_base_url:
        pytest.skip(
            "VS_PUBLIC_BASE_URL is not set — start a tunnel to local IIS "
            "(see docs/operations/local-integration-testing.md) to test the "
            "Carameli -> LegacyCRM direction"
        )
    return config.vs_public_base_url


@pytest_asyncio.fixture
async def carameli(config: LocalE2EConfig) -> AsyncIterator[CarameliApi]:
    """Authed client for the remote Carameli, closed after the test."""
    api = CarameliApi(config.carameli_base_url, config.carameli_api_key)
    try:
        yield api
    finally:
        await api.aclose()
