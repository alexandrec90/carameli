"""
Template: repository unit tests.

File: tests/unit/test_my_entity_repo.py

These tests run against a real PostgreSQL test DB (tables created fresh per test
session by the conftest fixtures). Requires Docker running.

Run:
  docker compose exec app pytest tests/unit/test_my_entity_repo.py -v

Steps:
  1. Replace MyEntityRepo / MyEntity with your class names.
  2. Adjust create_payload to match your schema fields.
  3. Add test cases for any custom query methods in your repo.
"""

# ruff: noqa: S101
from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

_BASE = "/vsapi/1.0.0/MyDomain"  # TODO: set your route prefix


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create(client, **kwargs) -> dict:
    """Helper — POST to the Create endpoint and assert 201."""
    # TODO: adjust payload fields
    payload = {
        # "name": kwargs.get("name", "Test Entity"),
        # "vs_customer_id": kwargs.get("vs_customer_id", 1),
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
async def test_get_by_id(client) -> None:
    created = await _create(client)
    entity_id = created["id"]

    # TODO: adjust path to match your GET endpoint
    resp = await client.get(f"{_BASE}/Get/{entity_id}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["id"] == entity_id


@pytest.mark.asyncio
async def test_get_not_found(client) -> None:
    import uuid

    fake_id = str(uuid.uuid4())
    resp = await client.get(f"{_BASE}/Get/{fake_id}", headers=AUTH_HEADERS)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_duplicate_returns_409(client) -> None:
    """If your model has a unique constraint, test that the 409 fires."""
    payload = {
        # TODO: fill in duplicate-triggering payload
    }
    await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 409
