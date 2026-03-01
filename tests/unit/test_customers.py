from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

_BASE = "/vsapi/1.0.0/VsCustomer"


async def _create(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
        "twilio_account_sid": f"ACtest{vs_id}",
        "twilio_auth_token": f"token{vs_id}",
    }
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_create_customer(client) -> None:
    data = await _create(client, 4001)
    assert data["vs_customer_id"] == 4001
    assert "id" in data
    assert data["active"] is True


@pytest.mark.asyncio
async def test_get_customer(client) -> None:
    await _create(client, 4002)
    resp = await client.get(f"{_BASE}/Get/4002", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["vs_customer_id"] == 4002


@pytest.mark.asyncio
async def test_get_customer_not_found(client) -> None:
    resp = await client.get(f"{_BASE}/Get/99999", headers=AUTH_HEADERS)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_customer_internal_id(client) -> None:
    data = await _create(client, 4003)
    resp = await client.get(f"{_BASE}/GetCustid/4003", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 4003
    assert body["internal_id"] == data["id"]


@pytest.mark.asyncio
async def test_create_duplicate_customer_returns_409(client) -> None:
    await _create(client, 4004)
    payload = {
        "vs_customer_id": 4004,
        "api_key": "key-4004-dup",
        "twilio_account_sid": "ACtest4004",
        "twilio_auth_token": "token4004",
    }
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 409
