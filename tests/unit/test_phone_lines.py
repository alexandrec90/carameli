from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"


async def _create_customer(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
        "twilio_account_sid": f"ACtest{vs_id}",
        "twilio_auth_token": f"token{vs_id}",
    }
    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_add_phone_line_by_area_code(client) -> None:
    await _create_customer(client, 5001)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(
        return_value=[{"phone_number": "+15005550100"}]
    )
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5001", "phone_number": "+15005550100"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5001, "area_code": "500"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json()["phone_number"] == "+15005550100"
    assert resp.json()["active"] is True


@pytest.mark.asyncio
async def test_get_phone_line(client) -> None:
    await _create_customer(client, 5002)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(
        return_value=[{"phone_number": "+15025550100"}]
    )
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5002", "phone_number": "+15025550100"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5002, "area_code": "502"},
        headers=AUTH_HEADERS,
    )

    resp = await client.get(
        f"{_LINE_BASE}/Get/5002/%2B15025550100", headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["phone_number"] == "+15025550100"


@pytest.mark.asyncio
async def test_get_phone_line_not_found(client) -> None:
    await _create_customer(client, 5003)
    resp = await client.get(
        f"{_LINE_BASE}/Get/5003/%2B10000000000", headers=AUTH_HEADERS
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_deactivate_phone_line(client) -> None:
    await _create_customer(client, 5004)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(
        return_value=[{"phone_number": "+15045550100"}]
    )
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5004", "phone_number": "+15045550100"}
    )
    app.state.carrier.release_number = AsyncMock(return_value=None)

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5004, "area_code": "504"},
        headers=AUTH_HEADERS,
    )

    resp = await client.put(
        f"{_LINE_BASE}/Deactivate",
        json={"vs_customer_id": 5004, "phone_number": "+15045550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["active"] is False


@pytest.mark.asyncio
async def test_get_phone_line_count(client) -> None:
    await _create_customer(client, 5005)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(
        return_value=[{"phone_number": "+15055550100"}]
    )
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5005", "phone_number": "+15055550100"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5005, "area_code": "505"},
        headers=AUTH_HEADERS,
    )

    resp = await client.get(f"{_LINE_BASE}/GetCount/5005", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


@pytest.mark.asyncio
async def test_update_call_recording(client) -> None:
    await _create_customer(client, 5006)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(
        return_value=[{"phone_number": "+15065550100"}]
    )
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5006", "phone_number": "+15065550100"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5006, "area_code": "506"},
        headers=AUTH_HEADERS,
    )

    # Enable recording
    resp = await client.put(
        f"{_LINE_BASE}/UpdateCallRecording",
        json={"vs_customer_id": 5006, "phone_number": "+15065550100", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["recording_enabled"] is True

    # Disable recording
    resp = await client.put(
        f"{_LINE_BASE}/UpdateCallRecording",
        json={"vs_customer_id": 5006, "phone_number": "+15065550100", "enabled": False},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["recording_enabled"] is False
