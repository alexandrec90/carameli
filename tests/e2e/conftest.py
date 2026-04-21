"""Playwright E2E test configuration.

Requires both backend and frontend running:
    docker compose up          # backend on :8000
    cd frontend && npm run dev # Vite on :5173

Install browser binaries once after adding pytest-playwright:
    playwright install --with-deps chromium

Run E2E tests:
    pytest tests/e2e/ --headed   # watch in browser
    pytest tests/e2e/            # headless (CI default)
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from playwright.sync_api import Page, sync_playwright

# Base URL for the frontend dev server.
# Override via: pytest tests/e2e/ --base-url http://localhost:5173
BASE_URL = "http://localhost:5173"

BROWSERS = ["chromium", "firefox", "webkit"]
VIEWPORTS = [
    {"width": 1280, "height": 800, "label": "desktop"},
    {"width": 375, "height": 812, "label": "mobile-portrait"},
    {"width": 812, "height": 375, "label": "mobile-landscape"},
]


@pytest.fixture(scope="session")
def base_url() -> str:
    """Frontend base URL used by E2E tests."""
    return BASE_URL


@pytest.fixture(params=BROWSERS, ids=BROWSERS)
def matrix_browser_name(request: pytest.FixtureRequest) -> str:
    """Browser engine used for explicit cross-browser matrix tests."""
    return str(request.param)


@pytest.fixture(params=VIEWPORTS, ids=[item["label"] for item in VIEWPORTS])
def viewport(request: pytest.FixtureRequest) -> dict[str, int | str]:
    """Viewport matrix for desktop and mobile layout validation."""
    return request.param


@pytest.fixture
def matrix_page(
    base_url: str,
    matrix_browser_name: str,
    viewport: dict[str, int | str],
) -> Generator[Page, None, None]:
    """Dedicated page fixture parametrized across browsers and viewports."""
    with sync_playwright() as playwright:
        browser_type = getattr(playwright, matrix_browser_name)
        browser = browser_type.launch(headless=True)
        context = browser.new_context(
            base_url=base_url,
            reduced_motion="reduce",
            viewport={
                "width": int(viewport["width"]),
                "height": int(viewport["height"]),
            },
        )
        page = context.new_page()

        try:
            yield page
        finally:
            context.close()
            browser.close()


@pytest.fixture(scope="session")
def browser_context_args(
    browser_context_args: dict[str, object], base_url: str
) -> dict[str, object]:
    """Shared browser context settings for all E2E tests."""
    return {
        **browser_context_args,
        "base_url": base_url,
        # Reduce flakiness from animations — force prefers-reduced-motion
        # so CSS animations/transitions resolve instantly.
        "reduced_motion": "reduce",
        "viewport": {
            "width": int(VIEWPORTS[0]["width"]),
            "height": int(VIEWPORTS[0]["height"]),
        },
    }
