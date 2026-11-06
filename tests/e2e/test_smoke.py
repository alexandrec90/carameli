"""E2E smoke tests — verify the app loads, navigates, and renders without errors.

These tests work regardless of the UI style (DOM, canvas, SVG, animated image).
They check structural health, not visual appearance.

Run:
    python scripts/e2e.py                       # starts everything it needs
    pytest tests/e2e/ -m local -v               # against a stack already running
    pytest tests/e2e/ -m local --headed         # watch in a real browser
    pytest tests/e2e/ -m local --browser webkit # test on WebKit
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import Page, Request, expect

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


# Hyphens, because the fix pass reads a `FAILED` line's id up to the first whitespace:
# a bare "Phone Lines" would sign that failure as `...[chromium-Phone`.
@pytest.mark.parametrize("path, label", ROUTES, ids=[r[1].replace(" ", "-") for r in ROUTES])
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
# The demo's promise, measured where the promise is kept
# ---------------------------------------------------------------------------

# Mirrors BACKEND_PROXY_PATTERN in frontend/vite.config.ts, kept as a literal for the
# reason test_asset_usage.py keeps its own: this suite checks the app from the outside.
BACKEND_PATH = re.compile(r"^/(api|auth|vsapi|vg|health)(/|$)")

# The stylesheets `index.html` links. Static type from a CDN, and no backend of ours.
FONT_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com")


def test_demo_build_makes_no_backend_requests(page: Page, base_url: str) -> None:
    """Every route a visitor walks stays off any backend, this stack's or a provider's.

    `noBackend.test.tsx` scans the source and watches `fetch`. This is the same promise
    with the browser as the witness, so an XMLHttpRequest, a beacon or a skin's own
    image request counts as well.
    """
    origin = urlsplit(base_url).netloc
    strays: list[str] = []

    def note(request: Request) -> None:
        parts = urlsplit(request.url)
        if parts.scheme in ("data", "blob") or parts.netloc in FONT_HOSTS:
            return
        if parts.netloc != origin or BACKEND_PATH.match(parts.path):
            strays.append(f"{request.method} {request.url}")

    page.on("request", note)
    for path, _label in ROUTES:
        page.goto(path)
        page.wait_for_load_state("networkidle")

    assert strays == [], f"The demo build reached past its own dev server: {strays}"


# ---------------------------------------------------------------------------
# Interaction
# ---------------------------------------------------------------------------


def test_nav_click_navigates(page: Page) -> None:
    """Clicking a nav link on the skin with DOM navigation changes the route."""
    # The default skin draws its navigation as art, so this names the one that does not.
    page.add_init_script("localStorage.setItem('skin', 'carameli')")
    page.goto("/")
    page.get_by_role("link", name="Phone Lines").first.click()
    expect(page).to_have_url(re.compile(r"/phone-lines"))
