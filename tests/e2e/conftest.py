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

import pytest

# Base URL for the frontend dev server.
# Override via: pytest tests/e2e/ --base-url http://localhost:5173
BASE_URL = "http://localhost:5173"


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Shared browser context settings for all E2E tests."""
    return {
        **browser_context_args,
        "base_url": BASE_URL,
        # Reduce flakiness from animations — force prefers-reduced-motion
        # so CSS animations/transitions resolve instantly.
        "reduced_motion": "reduce",
        # Viewport for consistent screenshots across machines.
        "viewport": {"width": 1280, "height": 720},
    }
