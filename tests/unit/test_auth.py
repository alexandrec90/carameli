from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS


async def _create_customer(client, vs_id: int, api_key: str) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": api_key,
    }
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json=payload,
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_missing_token_returns_401(client) -> None:
    resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/1")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_wrong_token_returns_401(client) -> None:
    resp = await client.get(
        "/vsapi/1.0.0/VsCustomer/Get/1",
        headers={"Authorization": "Bearer definitely-wrong-key"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_correct_token_passes_auth(client) -> None:
    # 404 means auth passed — the customer just doesn't exist
    resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/99999", headers=AUTH_HEADERS)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_customer_token_can_access_own_customer(client) -> None:
    await _create_customer(client, 9101, "cust-key-9101")

    resp = await client.get(
        "/vsapi/1.0.0/VsCustomer/Get/9101",
        headers={"Authorization": "Bearer cust-key-9101"},
    )
    assert resp.status_code == 200
    assert resp.json()["vs_customer_id"] == 9101


@pytest.mark.asyncio
async def test_customer_token_cannot_access_other_customer(client) -> None:
    await _create_customer(client, 9102, "cust-key-9102")
    await _create_customer(client, 9103, "cust-key-9103")

    resp = await client.get(
        "/vsapi/1.0.0/VsCustomer/Get/9103",
        headers={"Authorization": "Bearer cust-key-9102"},
    )
    assert resp.status_code == 403
