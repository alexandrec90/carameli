from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_HOOK_BASE = "/vsapi/1.0.0/VsWebhook"


async def _create_customer(client, vs_id: int) -> uuid.UUID:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return uuid.UUID(resp.json()["id"])


async def _add_subscription(client, vs_id: int, **over) -> dict:
    body = {
        "vs_customer_id": vs_id,
        "description": "Call ended hook",
        "uri": "https://hooks.example.com/events",
        "events": ["call.ended"],
        **over,
    }
    resp = await client.post(f"{_HOOK_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_webhook_subscription_success(client) -> None:
    await _create_customer(client, 7001)
    body = await _add_subscription(client, 7001)
    assert body["uri"] == "https://hooks.example.com/events"
    assert body["events"] == ["call.ended"]
    assert body["enabled"] is True
    assert body["active"] is True


async def test_add_webhook_subscription_invalid_uri(client) -> None:
    await _create_customer(client, 7002)
    resp = await client.post(
        f"{_HOOK_BASE}/Add",
        json={"vs_customer_id": 7002, "uri": "ftp://nope", "events": []},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_add_webhook_subscription_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_HOOK_BASE}/Add",
        json={"vs_customer_id": 799999, "uri": "https://hooks.example.com/x", "events": []},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_list_webhook_subscriptions_returns_customer_subs(client) -> None:
    await _create_customer(client, 7003)
    await _add_subscription(client, 7003, description="A", uri="https://hooks.example.com/a")
    await _add_subscription(client, 7003, description="B", uri="https://hooks.example.com/b")

    resp = await client.get(f"{_HOOK_BASE}/List/7003", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 7003
    assert {s["description"] for s in body["subscriptions"]} == {"A", "B"}


async def test_list_webhook_subscriptions_empty(client) -> None:
    await _create_customer(client, 7004)
    resp = await client.get(f"{_HOOK_BASE}/List/7004", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["subscriptions"] == []


async def test_list_webhook_subscriptions_isolated_per_customer(client) -> None:
    await _create_customer(client, 7005)
    await _create_customer(client, 7006)
    await _add_subscription(client, 7005)

    resp = await client.get(f"{_HOOK_BASE}/List/7006", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["subscriptions"] == []


async def test_deactivate_webhook_subscription_success(client) -> None:
    await _create_customer(client, 7007)
    created = await _add_subscription(client, 7007)

    resp = await client.put(f"{_HOOK_BASE}/Deactivate/7007/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    # The soft-deleted subscription no longer appears in the list.
    listed = await client.get(f"{_HOOK_BASE}/List/7007", headers=AUTH_HEADERS)
    assert listed.json()["subscriptions"] == []


async def test_deactivate_webhook_subscription_not_found(client) -> None:
    await _create_customer(client, 7008)
    resp = await client.put(f"{_HOOK_BASE}/Deactivate/7008/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Webhook subscription not found"
