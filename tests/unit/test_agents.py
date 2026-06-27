from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_AGENT_BASE = "/vsapi/1.0.0/VsAgent"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _add_agent(client, vs_id: int, **over) -> dict:
    body = {"vs_customer_id": vs_id, "name": "Alice", **over}
    resp = await client.post(f"{_AGENT_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_agent_success(client) -> None:
    await _create_customer(client, 7101)
    body = await _add_agent(client, 7101, name="Bob")
    assert body["name"] == "Bob"
    assert body["status"] == "available"
    assert body["active"] is True
    assert body["extension_id"] is None


async def test_add_agent_with_status(client) -> None:
    await _create_customer(client, 7102)
    body = await _add_agent(client, 7102, name="Carol", status="unavailable")
    assert body["status"] == "unavailable"


async def test_add_agent_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_AGENT_BASE}/Add",
        json={"vs_customer_id": 799001, "name": "Ghost"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_add_agent_missing_name_returns_422(client) -> None:
    await _create_customer(client, 7103)
    resp = await client.post(
        f"{_AGENT_BASE}/Add",
        json={"vs_customer_id": 7103},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_list_agents_returns_customer_agents(client) -> None:
    await _create_customer(client, 7104)
    await _add_agent(client, 7104, name="Alice")
    await _add_agent(client, 7104, name="Bob")

    resp = await client.get(f"{_AGENT_BASE}/List/7104", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 7104
    assert {a["name"] for a in body["agents"]} == {"Alice", "Bob"}


async def test_list_agents_empty(client) -> None:
    await _create_customer(client, 7105)
    resp = await client.get(f"{_AGENT_BASE}/List/7105", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["agents"] == []


async def test_list_agents_isolated_per_customer(client) -> None:
    await _create_customer(client, 7106)
    await _create_customer(client, 7107)
    await _add_agent(client, 7106, name="Alice")

    resp = await client.get(f"{_AGENT_BASE}/List/7107", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["agents"] == []


async def test_list_agents_customer_not_found(client) -> None:
    resp = await client.get(f"{_AGENT_BASE}/List/799002", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_deactivate_agent_success(client) -> None:
    await _create_customer(client, 7108)
    created = await _add_agent(client, 7108, name="Dave")

    resp = await client.put(f"{_AGENT_BASE}/Deactivate/7108/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_AGENT_BASE}/List/7108", headers=AUTH_HEADERS)
    assert listed.json()["agents"] == []


async def test_deactivate_agent_not_found(client) -> None:
    await _create_customer(client, 7109)
    resp = await client.put(f"{_AGENT_BASE}/Deactivate/7109/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Agent not found"


async def test_deactivate_agent_cross_customer_blocked(client) -> None:
    await _create_customer(client, 7110)
    await _create_customer(client, 7111)
    created = await _add_agent(client, 7110, name="Eve")

    # Customer 7111 should not be able to deactivate customer 7110's agent.
    resp = await client.put(f"{_AGENT_BASE}/Deactivate/7111/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
