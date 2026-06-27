from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_AGENT_BASE = "/vsapi/1.0.0/VsAgent"
_SKILL_BASE = "/vsapi/1.0.0/VsAgentSkill"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _add_agent(client, vs_id: int, name: str = "Alice") -> dict:
    resp = await client.post(
        f"{_AGENT_BASE}/Add",
        json={"vs_customer_id": vs_id, "name": name},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _add_skill(client, vs_id: int, agent_id: str, **over) -> dict:
    body = {"vs_customer_id": vs_id, "agent_id": agent_id, "skill": "english", **over}
    resp = await client.post(f"{_SKILL_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_agent_skill_success(client) -> None:
    await _create_customer(client, 7301)
    agent = await _add_agent(client, 7301)
    body = await _add_skill(client, 7301, agent["id"], skill="spanish", level=80)
    assert body["skill"] == "spanish"
    assert body["level"] == 80
    assert body["agent_id"] == agent["id"]
    assert body["active"] is True


async def test_add_agent_skill_default_level(client) -> None:
    await _create_customer(client, 7302)
    agent = await _add_agent(client, 7302)
    body = await _add_skill(client, 7302, agent["id"], skill="french")
    assert body["level"] == 1


async def test_add_agent_skill_agent_not_found(client) -> None:
    await _create_customer(client, 7303)
    resp = await client.post(
        f"{_SKILL_BASE}/Add",
        json={"vs_customer_id": 7303, "agent_id": str(uuid.uuid4()), "skill": "english"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Agent not found"


async def test_add_agent_skill_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_SKILL_BASE}/Add",
        json={"vs_customer_id": 799020, "agent_id": str(uuid.uuid4()), "skill": "english"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_add_agent_skill_level_out_of_range(client) -> None:
    await _create_customer(client, 7304)
    agent = await _add_agent(client, 7304)
    resp = await client.post(
        f"{_SKILL_BASE}/Add",
        json={"vs_customer_id": 7304, "agent_id": agent["id"], "skill": "english", "level": 200},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_list_agent_skills_returns_all_for_customer(client) -> None:
    await _create_customer(client, 7305)
    agent = await _add_agent(client, 7305)
    await _add_skill(client, 7305, agent["id"], skill="english")
    await _add_skill(client, 7305, agent["id"], skill="spanish")

    resp = await client.get(f"{_SKILL_BASE}/List/7305", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 7305
    assert {s["skill"] for s in body["agent_skills"]} == {"english", "spanish"}


async def test_list_agent_skills_empty(client) -> None:
    await _create_customer(client, 7306)
    resp = await client.get(f"{_SKILL_BASE}/List/7306", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["agent_skills"] == []


async def test_list_agent_skills_isolated_per_customer(client) -> None:
    await _create_customer(client, 7307)
    await _create_customer(client, 7308)
    agent = await _add_agent(client, 7307)
    await _add_skill(client, 7307, agent["id"], skill="english")

    resp = await client.get(f"{_SKILL_BASE}/List/7308", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["agent_skills"] == []


async def test_list_agent_skills_customer_not_found(client) -> None:
    resp = await client.get(f"{_SKILL_BASE}/List/799021", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_deactivate_agent_skill_success(client) -> None:
    await _create_customer(client, 7309)
    agent = await _add_agent(client, 7309)
    created = await _add_skill(client, 7309, agent["id"], skill="german")

    resp = await client.put(f"{_SKILL_BASE}/Deactivate/7309/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_SKILL_BASE}/List/7309", headers=AUTH_HEADERS)
    assert listed.json()["agent_skills"] == []


async def test_deactivate_agent_skill_not_found(client) -> None:
    await _create_customer(client, 7310)
    resp = await client.put(f"{_SKILL_BASE}/Deactivate/7310/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Agent skill not found"


async def test_deactivate_agent_skill_cross_customer_blocked(client) -> None:
    await _create_customer(client, 7311)
    await _create_customer(client, 7312)
    agent = await _add_agent(client, 7311)
    created = await _add_skill(client, 7311, agent["id"], skill="mandarin")

    resp = await client.put(f"{_SKILL_BASE}/Deactivate/7312/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_add_agent_skill_cross_customer_agent_blocked(client) -> None:
    """A customer cannot add a skill to another customer's agent."""
    await _create_customer(client, 7313)
    await _create_customer(client, 7314)
    agent = await _add_agent(client, 7313)

    resp = await client.post(
        f"{_SKILL_BASE}/Add",
        json={"vs_customer_id": 7314, "agent_id": agent["id"], "skill": "english"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Agent not found"
