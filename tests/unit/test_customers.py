from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_BASE = "/vsapi/1.0.0/VsCustomer"


async def _create(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
    }
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


async def test_create_customer(client) -> None:
    data = await _create(client, 4001)
    assert data["vs_customer_id"] == 4001
    assert "id" in data
    assert data["active"] is True


async def test_legacy_add_customer_alias(client) -> None:
    """VanillaSoft's CloudliClient still POSTs to VsCustomer/Add."""
    payload = {
        "vs_customer_id": 4006,
        "api_key": "key-4006",
    }
    resp = await client.post(f"{_BASE}/Add", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    assert resp.json()["vs_customer_id"] == 4006


async def test_get_customer(client) -> None:
    await _create(client, 4002)
    resp = await client.get(f"{_BASE}/Get/4002", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["vs_customer_id"] == 4002


async def test_get_customer_not_found(client) -> None:
    resp = await client.get(f"{_BASE}/Get/99999", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_get_customer_internal_id(client) -> None:
    data = await _create(client, 4003)
    resp = await client.get(f"{_BASE}/GetCustid/4003", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 4003
    assert body["internal_id"] == data["id"]


async def test_create_duplicate_customer_returns_409(client) -> None:
    await _create(client, 4004)
    payload = {
        "vs_customer_id": 4004,
        "api_key": "key-4004-dup",
    }
    resp = await client.post(f"{_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 409


async def test_get_phone_lines_returns_active_only(client, db_session) -> None:
    """GetPhoneLines should only return active DIDs for the customer."""
    import uuid

    from app.repositories.phone_line_repo import PhoneLineRepo

    data = await _create(client, 4005)
    customer_id = uuid.UUID(data["id"])

    line_repo = PhoneLineRepo(db_session)
    await line_repo.create(
        customer_id=customer_id, phone_number="+14005550001", provider_sid="PNcust4005a"
    )
    inactive = await line_repo.create(
        customer_id=customer_id, phone_number="+14005550002", provider_sid="PNcust4005b"
    )
    await line_repo.deactivate(inactive)

    resp = await client.get(f"{_BASE}/GetPhoneLines/4005", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    numbers = [item["phone_number"] for item in resp.json()]
    assert "+14005550001" in numbers
    assert "+14005550002" not in numbers


async def test_get_phone_lines_unknown_customer_returns_404(client) -> None:
    resp = await client.get(f"{_BASE}/GetPhoneLines/99993", headers=AUTH_HEADERS)
    assert resp.status_code == 404
