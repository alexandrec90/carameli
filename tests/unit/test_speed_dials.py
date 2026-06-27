from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_SD_BASE = "/vsapi/1.0.0/VsSpeedDial"


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_dial(client, vs_id: int, **over) -> dict:
    body = {
        "vs_customer_id": vs_id,
        "code": "01",
        "phone_number": "+15551234567",
        "description": "Main office",
        **over,
    }
    resp = await client.post(f"{_SD_BASE}/Add", json=body, headers=AUTH_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_add_speed_dial_success(client) -> None:
    await _create_customer(client, 8201)
    body = await _add_dial(client, 8201)
    assert body["code"] == "01"
    assert body["phone_number"] == "+15551234567"
    assert body["description"] == "Main office"
    assert body["active"] is True


async def test_add_speed_dial_customer_not_found(client) -> None:
    resp = await client.post(
        f"{_SD_BASE}/Add",
        json={"vs_customer_id": 829901, "code": "99", "phone_number": "+15559999999"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_list_speed_dials_returns_customer_dials(client) -> None:
    await _create_customer(client, 8202)
    await _add_dial(client, 8202, code="10", phone_number="+15550000001")
    await _add_dial(client, 8202, code="20", phone_number="+15550000002")

    resp = await client.get(f"{_SD_BASE}/List/8202", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 8202
    assert {d["code"] for d in body["speed_dials"]} == {"10", "20"}


async def test_list_speed_dials_empty(client) -> None:
    await _create_customer(client, 8203)
    resp = await client.get(f"{_SD_BASE}/List/8203", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["speed_dials"] == []


async def test_list_speed_dials_isolated_per_customer(client) -> None:
    await _create_customer(client, 8204)
    await _create_customer(client, 8205)
    await _add_dial(client, 8204, code="50")

    resp = await client.get(f"{_SD_BASE}/List/8205", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["speed_dials"] == []


async def test_deactivate_speed_dial_success(client) -> None:
    await _create_customer(client, 8206)
    created = await _add_dial(client, 8206, code="77")

    resp = await client.put(f"{_SD_BASE}/Deactivate/8206/{created['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    listed = await client.get(f"{_SD_BASE}/List/8206", headers=AUTH_HEADERS)
    assert listed.json()["speed_dials"] == []


async def test_deactivate_speed_dial_not_found(client) -> None:
    await _create_customer(client, 8207)
    resp = await client.put(f"{_SD_BASE}/Deactivate/8207/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Speed dial not found"
