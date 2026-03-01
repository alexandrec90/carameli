"""
Template: endpoint unit tests (runs against real test DB, Twilio mocked via app.state).

File: tests/unit/test_<domain>.py

These tests use the `client` fixture from conftest.py which:
  - Creates a fresh test DB schema (creates + drops all tables per session)
  - Injects a real AsyncSession with rollback after each test
  - Wires app.state.twilio to a MagicMock — mock specific methods with AsyncMock

Run:
  docker compose exec app pytest tests/unit/test_my_domain.py -v

Steps:
  1. Replace _BASE with your actual route prefix.
  2. Replace _create() helper with a helper matching your Create endpoint shape.
  3. Add AUTH_HEADERS to every request — every route is authenticated.
  4. Mock any app.state.twilio methods your route calls (purchase_did, send_sms, etc.).
  5. Test the happy path, the 404 path, and any 409/400 paths.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

_BASE = "/vsapi/1.0.0/MyDomain"  # TODO: update


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create(client, **overrides) -> dict:
    """POST to Create and assert 201. Returns parsed JSON."""
    payload = {
        # TODO: fill in required fields for your Create request
        # "vs_customer_id": overrides.get("vs_customer_id", 9001),
        # "name": overrides.get("name", "fixture-entity"),
    }
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create(client) -> None:
    data = await _create(client)
    assert "id" in data
    assert data["active"] is True


@pytest.mark.asyncio
async def test_create_requires_auth(client) -> None:
    resp = await client.post(f"{_BASE}/Create", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_not_found(client) -> None:
    import uuid
    fake_id = str(uuid.uuid4())
    # TODO: adjust path to match your GET endpoint signature
    resp = await client.get(f"{_BASE}/Get/9001/{fake_id}", headers=AUTH_HEADERS)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_twilio_call_mocked(client) -> None:
    """Example: mock a Twilio operation that your route delegates to."""
    from app.main import app

    app.state.twilio.some_method = AsyncMock(  # TODO: replace some_method
        return_value={"sid": "PNtest0001", "result": "ok"}
    )

    # TODO: hit the endpoint that triggers the Twilio call
    # resp = await client.post(f"{_BASE}/...", json={...}, headers=AUTH_HEADERS)
    # assert resp.status_code == 200
    # app.state.twilio.some_method.assert_called_once()


@pytest.mark.asyncio
async def test_create_duplicate_returns_409(client) -> None:
    """Only add this test if your model has a unique constraint."""
    await _create(client)
    # Attempt to create the same entity again
    payload = {
        # TODO: same payload as _create, triggering the unique violation
    }
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 409
