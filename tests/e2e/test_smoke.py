"""E2E smoke tests — verify the app loads, navigates, and renders without errors.

These tests work regardless of the UI style (DOM, canvas, SVG, animated image).
They check structural health, not visual appearance — visual regression
screenshots will be added once the interaction pattern is finalized.

Run:
    pytest tests/e2e/ -v
    pytest tests/e2e/ --headed          # watch in a real browser
    pytest tests/e2e/ --browser webkit  # test on WebKit
"""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Page, expect

# ---------------------------------------------------------------------------
# App loads
# ---------------------------------------------------------------------------


def test_app_loads(page: Page) -> None:
    """Frontend serves a page and renders the root React mount point."""
    page.goto("/")
    # Vite injects into #root — if this is missing, the app didn't mount at all.
    root = page.locator("#root")
    expect(root).to_be_attached()


def test_no_uncaught_js_errors(page: Page) -> None:
    """No uncaught JavaScript exceptions during initial load."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto("/")
    # Give the app a moment to finish async work (skin loading, API calls).
    page.wait_for_timeout(2000)

    assert errors == [], f"Uncaught JS errors on load: {errors}"


# ---------------------------------------------------------------------------
# Navigation — each route renders without crashing
# ---------------------------------------------------------------------------

ROUTES = [
    ("/", "Dashboard"),
    ("/phone-lines", "Phone Lines"),
    ("/extensions", "Extensions"),
    ("/sms", "SMS"),
    ("/calls", "Call Events"),
    ("/settings", "Settings"),
]


@pytest.mark.parametrize("path, label", ROUTES, ids=[r[1] for r in ROUTES])
def test_route_renders(page: Page, path: str, label: str) -> None:
    """Each route loads without JS errors and renders visible content."""
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(path)
    page.wait_for_load_state("networkidle")

    # The page should have *something* visible — not a blank white screen.
    # Using inner_text on body ensures at least some text rendered.
    body_text = page.locator("body").inner_text(timeout=5000)
    assert len(body_text.strip()) > 0, f"Route {path} rendered a blank page"

    assert errors == [], f"JS errors on {path}: {errors}"


# ---------------------------------------------------------------------------
# Backend reachability (frontend proxy → backend health)
# ---------------------------------------------------------------------------


def test_backend_health_reachable_from_browser(page: Page) -> None:
    """Vite dev server proxies /health to the backend — verify it responds."""
    resp = page.request.get("/health")
    assert resp.status == 200
    body = resp.json()
    assert "status" in body


# ---------------------------------------------------------------------------
# Console error audit
# ---------------------------------------------------------------------------


def test_no_console_errors_on_dashboard(page: Page) -> None:
    """No console.error calls during dashboard load."""
    console_errors: list[str] = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

    page.goto("/")
    page.wait_for_load_state("networkidle")

    # Filter out known noise (e.g. favicon 404, React devtools).
    real_errors = [
        e
        for e in console_errors
        if "favicon" not in e.lower() and "react-devtools" not in e.lower()
    ]
    assert real_errors == [], f"Console errors: {real_errors}"


# ---------------------------------------------------------------------------
# Visual regression — baseline screenshots
# ---------------------------------------------------------------------------
# These are placeholder tests. Once the UI interaction pattern is settled,
# replace with targeted screenshots of specific UI states.


@pytest.mark.skip(reason="Enable after UI interaction pattern is finalized")
def test_dashboard_screenshot(page: Page) -> None:
    """Visual regression baseline for the dashboard."""
    page.goto("/")
    page.wait_for_load_state("networkidle")
    # Animations frozen via reduced_motion in conftest.
    expect(page).to_have_screenshot(
        "dashboard.png",
        max_diff_pixel_ratio=0.01,
    )


@pytest.mark.skip(reason="Enable after UI interaction pattern is finalized")
def test_phone_lines_screenshot(page: Page) -> None:
    """Visual regression baseline for the phone lines page."""
    page.goto("/phone-lines")
    page.wait_for_load_state("networkidle")
    expect(page).to_have_screenshot(
        "phone-lines.png",
        max_diff_pixel_ratio=0.01,
    )


# ---------------------------------------------------------------------------
# Interaction stand-ins — will be fleshed out once clickable elements are
# implemented with semantic roles (Option A/B from the testing plan).
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Enable once nav elements have accessible roles")
def test_nav_click_navigates(page: Page) -> None:
    """Clicking a nav element navigates to the correct route."""
    page.goto("/")
    # Replace with the actual selector once the interaction pattern is decided.
    # Option A (DOM overlay): page.get_by_role("link", name="Phone Lines")
    # Option B (SVG):         page.locator("svg [role='button'][aria-label='Phone Lines']")
    nav_link = page.get_by_role("link", name="Phone Lines")
    nav_link.click()
    expect(page).to_have_url(re.compile(r"/phone-lines"))
