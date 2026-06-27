from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_QUEUE_BASE = "/vsapi/1.0.0/VsCallQueue"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _add_queue(client, vs_id: int, **over) -> dict:
    body = {"vs_customer_id": vs_id, "name": "Support", **over}
    resp = await client.post(f"{_QUEUE_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_call_queue_success(client) -> None:
    await _create_customer(client, 7201)
    body = await _add_queue(client, 7201, name="Sales")
    assert body["name"] == "Sales"
    assert body["strategy"] == "round-robin"
    assert body["active"] is True


async def test_add_call_queue_custom_strategy(client) -> None:
    await _create_customer(client, 7202)
    body = await _add_queue(client, 7202, name="Ring All", strategy="ring-all")
    assert body["strategy"] == "ring-all"


async def test_add_call_queue_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_QUEUE_BASE}/Add",
        json={"vs_customer_id": 799010, "name": "Ghost"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_add_call_queue_missing_name_returns_422(client) -> None:
    await _create_customer(client, 7203)
    resp = await client.post(
        f"{_QUEUE_BASE}/Add",
        json={"vs_customer_id": 7203},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_list_call_queues_returns_customer_queues(client) -> None:
    await _create_customer(client, 7204)
    await _add_queue(client, 7204, name="Sales")
    await _add_queue(client, 7204, name="Support")

    resp = await client.get(f"{_QUEUE_BASE}/List/7204", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 7204
    assert {q["name"] for q in body["call_queues"]} == {"Sales", "Support"}


async def test_list_call_queues_empty(client) -> None:
    await _create_customer(client, 7205)
    resp = await client.get(f"{_QUEUE_BASE}/List/7205", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["call_queues"] == []


async def test_list_call_queues_isolated_per_customer(client) -> None:
    await _create_customer(client, 7206)
    await _create_customer(client, 7207)
    await _add_queue(client, 7206, name="Sales")

    resp = await client.get(f"{_QUEUE_BASE}/List/7207", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["call_queues"] == []


async def test_list_call_queues_customer_not_found(client) -> None:
    resp = await client.get(f"{_QUEUE_BASE}/List/799011", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_deactivate_call_queue_success(client) -> None:
    await _create_customer(client, 7208)
    created = await _add_queue(client, 7208, name="Temp")

    resp = await client.put(f"{_QUEUE_BASE}/Deactivate/7208/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_QUEUE_BASE}/List/7208", headers=AUTH_HEADERS)
    assert listed.json()["call_queues"] == []


async def test_deactivate_call_queue_not_found(client) -> None:
    await _create_customer(client, 7209)
    resp = await client.put(f"{_QUEUE_BASE}/Deactivate/7209/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Call queue not found"


async def test_deactivate_call_queue_cross_customer_blocked(client) -> None:
    await _create_customer(client, 7210)
    await _create_customer(client, 7211)
    created = await _add_queue(client, 7210, name="Mine")

    resp = await client.put(f"{_QUEUE_BASE}/Deactivate/7211/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
