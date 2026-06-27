from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_EM_BASE = "/vsapi/1.0.0/VsExpansionModule"


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_module(client, vs_id: int, **over) -> dict:
    body = {
        "vs_customer_id": vs_id,
        "description": "Reception desk",
        "brand": "Yealink",
        "model": "EXP50",
        **over,
    }
    resp = await client.post(f"{_EM_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_expansion_module_success(client) -> None:
    await _create_customer(client, 8101)
    body = await _add_module(client, 8101)
    assert body["brand"] == "Yealink"
    assert body["model"] == "EXP50"
    assert body["description"] == "Reception desk"
    assert body["active"] is True


async def test_add_expansion_module_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_EM_BASE}/Add",
        json={"vs_customer_id": 819901, "description": "x", "brand": "X", "model": "Y"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_list_expansion_modules_returns_customer_modules(client) -> None:
    await _create_customer(client, 8102)
    await _add_module(client, 8102, description="A", brand="Cisco", model="CP-8800")
    await _add_module(client, 8102, description="B", brand="Polycom", model="VVX500")

    resp = await client.get(f"{_EM_BASE}/List/8102", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 8102
    assert {m["brand"] for m in body["expansion_modules"]} == {"Cisco", "Polycom"}


async def test_list_expansion_modules_empty(client) -> None:
    await _create_customer(client, 8103)
    resp = await client.get(f"{_EM_BASE}/List/8103", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["expansion_modules"] == []


async def test_list_expansion_modules_isolated_per_customer(client) -> None:
    await _create_customer(client, 8104)
    await _create_customer(client, 8105)
    await _add_module(client, 8104)

    resp = await client.get(f"{_EM_BASE}/List/8105", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["expansion_modules"] == []


async def test_deactivate_expansion_module_success(client) -> None:
    await _create_customer(client, 8106)
    created = await _add_module(client, 8106, description="To remove")

    resp = await client.put(f"{_EM_BASE}/Deactivate/8106/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_EM_BASE}/List/8106", headers=AUTH_HEADERS)
    assert listed.json()["expansion_modules"] == []


async def test_deactivate_expansion_module_not_found(client) -> None:
    await _create_customer(client, 8107)
    resp = await client.put(f"{_EM_BASE}/Deactivate/8107/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Expansion module not found"
