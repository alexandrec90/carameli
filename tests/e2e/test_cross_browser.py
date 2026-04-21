"""Cross-browser smoke matrix.

Runs core user journeys on Chromium, Firefox, and WebKit.
Also validates mobile viewports for layout breakage.
"""

from __future__ import annotations

from playwright.sync_api import Page


def test_home_page_loads(
    matrix_page: Page,
    base_url: str,
    matrix_browser_name: str,
    viewport: dict[str, int | str],
) -> None:
    """Verify the app shell renders without JS errors on all browsers/viewports."""
    errors: list[str] = []
    matrix_page.on("pageerror", lambda err: errors.append(str(err)))

    matrix_page.goto(base_url)
    matrix_page.wait_for_load_state("networkidle")

    assert errors == [], (
        f"JS errors on page load (browser={matrix_browser_name}, "
        f"viewport={viewport['label']}): {errors}"
    )


def test_health_endpoint_reachable(matrix_page: Page, base_url: str) -> None:
    """Verify /health returns ok via the frontend proxy."""
    resp = matrix_page.request.get(f"{base_url}/health")

    assert resp.ok
    data = resp.json()
    assert data["status"] == "ok"


def test_no_layout_overflow_on_mobile(matrix_page: Page, base_url: str) -> None:
    """Verify no horizontal overflow on a 375 px viewport."""
    matrix_page.set_viewport_size({"width": 375, "height": 812})
    matrix_page.goto(base_url)
    matrix_page.wait_for_load_state("networkidle")

    scroll_width = matrix_page.evaluate("document.documentElement.scrollWidth")
    assert scroll_width <= 375, f"Horizontal overflow detected: scrollWidth={scroll_width}"
