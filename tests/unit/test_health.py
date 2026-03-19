from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_health_check(client) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_unauthorized_without_key(client) -> None:
    response = await client.get("/vsapi/1.0.0/VsCustomer/Get/1")
    assert response.status_code == 401


async def test_customer_not_found(client) -> None:
    from tests.conftest import AUTH_HEADERS

    response = await client.get("/vsapi/1.0.0/VsCustomer/Get/9999", headers=AUTH_HEADERS)
    assert response.status_code == 404


async def test_create_and_get_customer(client) -> None:
    from tests.conftest import AUTH_HEADERS

    payload = {
        "vs_customer_id": 9901,
        "api_key": "test-key-unit-abc",
    }
    create_resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create", json=payload, headers=AUTH_HEADERS
    )
    assert create_resp.status_code == 201
    data = create_resp.json()
    assert data["vs_customer_id"] == 9901

    get_resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/9901", headers=AUTH_HEADERS)
    assert get_resp.status_code == 200
    assert get_resp.json()["vs_customer_id"] == 9901
