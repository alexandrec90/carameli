from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_EXT_BASE = "/vsapi/1.0.0/VsExtension"


async def _create_customer(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
    }
    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_add_extension(client) -> None:
    await _create_customer(client, 7001)
    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": 7001, "extension_number": "100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["extension_number"] == "100"
    assert body["active"] is True
    assert "sip_username" in body


@pytest.mark.asyncio
async def test_add_extension_duplicate_returns_409(client) -> None:
    await _create_customer(client, 7002)
    payload = {"vs_customer_id": 7002, "extension_number": "101"}
    await client.post(f"{_EXT_BASE}/Add", json=payload, headers=AUTH_HEADERS)
    resp = await client.post(f"{_EXT_BASE}/Add", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_add_extension_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": 99998, "extension_number": "102"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_available_extensions_excludes_used(client) -> None:
    await _create_customer(client, 7003)
    # Add extension 200; it should NOT appear in the available range 200–205.
    await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": 7003, "extension_number": "200"},
        headers=AUTH_HEADERS,
    )
    resp = await client.get(
        f"{_EXT_BASE}/GetAvailable/7003/200/205", headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "200" not in body["available"]
    assert "201" in body["available"]
    assert body["vs_customer_id"] == 7003


@pytest.mark.asyncio
async def test_get_available_extensions_unknown_customer_returns_404(client) -> None:
    resp = await client.get(
        f"{_EXT_BASE}/GetAvailable/99997/100/110", headers=AUTH_HEADERS
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_deactivate_extension(client) -> None:
    await _create_customer(client, 7004)
    await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": 7004, "extension_number": "300"},
        headers=AUTH_HEADERS,
    )
    resp = await client.put(f"{_EXT_BASE}/Deactivate/7004/300", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False


@pytest.mark.asyncio
async def test_deactivate_extension_not_found_returns_404(client) -> None:
    await _create_customer(client, 7005)
    resp = await client.put(f"{_EXT_BASE}/Deactivate/7005/999", headers=AUTH_HEADERS)
    assert resp.status_code == 404
