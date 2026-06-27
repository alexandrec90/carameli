from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_EC_BASE = "/vsapi/1.0.0/VsExemptionCode"


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_code(client, vs_id: int, **over) -> dict:
    body = {
        "vs_customer_id": vs_id,
        "description": "Long distance override",
        "code": "EXEMPT01",
        "call_restrictions": "international",
        **over,
    }
    resp = await client.post(f"{_EC_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_exemption_code_success(client) -> None:
    await _create_customer(client, 8001)
    body = await _add_code(client, 8001)
    assert body["code"] == "EXEMPT01"
    assert body["description"] == "Long distance override"
    assert body["call_restrictions"] == "international"
    assert body["active"] is True


async def test_add_exemption_code_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_EC_BASE}/Add",
        json={"vs_customer_id": 899901, "description": "x", "code": "X"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_list_exemption_codes_returns_customer_codes(client) -> None:
    await _create_customer(client, 8002)
    await _add_code(client, 8002, description="A", code="AAA")
    await _add_code(client, 8002, description="B", code="BBB")

    resp = await client.get(f"{_EC_BASE}/List/8002", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 8002
    assert {c["code"] for c in body["exemption_codes"]} == {"AAA", "BBB"}


async def test_list_exemption_codes_empty(client) -> None:
    await _create_customer(client, 8003)
    resp = await client.get(f"{_EC_BASE}/List/8003", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["exemption_codes"] == []


async def test_list_exemption_codes_isolated_per_customer(client) -> None:
    await _create_customer(client, 8004)
    await _create_customer(client, 8005)
    await _add_code(client, 8004, code="C1")

    resp = await client.get(f"{_EC_BASE}/List/8005", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["exemption_codes"] == []


async def test_deactivate_exemption_code_success(client) -> None:
    await _create_customer(client, 8006)
    created = await _add_code(client, 8006, code="DEL1")

    resp = await client.put(f"{_EC_BASE}/Deactivate/8006/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_EC_BASE}/List/8006", headers=AUTH_HEADERS)
    assert listed.json()["exemption_codes"] == []


async def test_deactivate_exemption_code_not_found(client) -> None:
    await _create_customer(client, 8007)
    resp = await client.put(f"{_EC_BASE}/Deactivate/8007/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Exemption code not found"
