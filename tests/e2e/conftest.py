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

import os
from collections.abc import Generator
from typing import TypedDict, cast

import pytest
from playwright.sync_api import Page, Playwright

# Base URL for the frontend dev server. A worktree does not get :5173 -- each box
# leases its own ports -- so this is overridable, and both spellings work:
#     pytest tests/e2e/ --base-url http://127.0.0.1:5199
#     E2E_BASE_URL=http://127.0.0.1:5199 pytest tests/e2e/
# The comment here used to promise the flag alone, while the fixture below returned the
# constant unconditionally and the flag did nothing.
DEFAULT_BASE_URL = "http://localhost:5173"
BASE_URL = os.environ.get("E2E_BASE_URL", DEFAULT_BASE_URL)

BROWSERS = ["chromium", "firefox", "webkit"]


class Viewport(TypedDict):
    """One entry in the layout matrix.

    Spelled out rather than left as a dict literal: mixed int/str values infer as
    `dict[str, object]`, and `int(entry["width"])` on an `object` is a type error at
    every use site.
    """

    width: int
    height: int
    label: str


VIEWPORTS: list[Viewport] = [
    {"width": 1280, "height": 800, "label": "desktop"},
    {"width": 375, "height": 812, "label": "mobile-portrait"},
    {"width": 812, "height": 375, "label": "mobile-landscape"},
]


@pytest.fixture(scope="session")
def base_url(request: pytest.FixtureRequest) -> str:
    """Frontend base URL used by E2E tests, most explicit source winning."""
    from_cli = request.config.getoption("--base-url", default=None)
    return str(from_cli) if from_cli else BASE_URL


@pytest.fixture(params=BROWSERS, ids=BROWSERS)
def matrix_browser_name(request: pytest.FixtureRequest) -> str:
    """Browser engine used for explicit cross-browser matrix tests."""
    return str(request.param)


@pytest.fixture(params=VIEWPORTS, ids=[item["label"] for item in VIEWPORTS])
def viewport(request: pytest.FixtureRequest) -> Viewport:
    """Viewport matrix for desktop and mobile layout validation."""
    return cast(Viewport, request.param)


@pytest.fixture
def matrix_page(
    playwright: Playwright,
    base_url: str,
    matrix_browser_name: str,
    viewport: Viewport,
) -> Generator[Page, None, None]:
    """Dedicated page fixture parametrized across browsers and viewports.

    Takes pytest-playwright's session-scoped ``playwright`` fixture rather than
    opening a second ``sync_playwright()``. The sync API drives its own event loop
    on this thread, so a nested one raises "Playwright Sync API inside the asyncio
    loop" as soon as *any* earlier test has started the plugin's. Nothing in
    tests/e2e/ sorted before this module until test_asset_usage.py landed; from
    that night on, all 27 tests here errored in setup.
    """
    browser_type = getattr(playwright, matrix_browser_name)
    browser = browser_type.launch(headless=True)
    context = browser.new_context(
        base_url=base_url,
        reduced_motion="reduce",
        viewport={"width": viewport["width"], "height": viewport["height"]},
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
            "width": VIEWPORTS[0]["width"],
            "height": VIEWPORTS[0]["height"],
        },
    }
