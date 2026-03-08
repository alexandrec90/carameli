from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_SMS_BASE = "/vsapi/1.0.0/VsMessaging/Sms"


async def _setup(client, vs_id: int, phone_number: str) -> None:
    """Create a customer and a phone line with carrier/engine mocks."""
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
    }
    await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(
        return_value=[{"phone_number": phone_number}]
    )
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": f"PNtest{vs_id}", "phone_number": phone_number}
    )
    app.state.carrier.enable_sms = AsyncMock(return_value=None)
    app.state.carrier.disable_sms = AsyncMock(return_value=None)
    app.state.carrier.send_sms = AsyncMock(
        return_value={"sid": f"SMtest{vs_id}", "status": "sent"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "area_code": "600"},
        headers=AUTH_HEADERS,
    )


@pytest.mark.asyncio
async def test_sms_enable(client) -> None:
    await _setup(client, 6001, "+16015550100")
    encoded = "%2B16015550100"
    resp = await client.put(f"{_SMS_BASE}/Enable/6001/{encoded}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["sms_enabled"] is True


@pytest.mark.asyncio
async def test_sms_send(client) -> None:
    await _setup(client, 6002, "+16025550100")
    encoded = "%2B16025550100"
    await client.put(f"{_SMS_BASE}/Enable/6002/{encoded}", headers=AUTH_HEADERS)

    resp = await client.post(
        f"{_SMS_BASE}/Send/6002",
        json={
            "from_number": "+16025550100",
            "to_number": "+15005550001",
            "body": "Hello from test",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_sms_disable(client) -> None:
    await _setup(client, 6003, "+16035550100")
    encoded = "%2B16035550100"
    await client.put(f"{_SMS_BASE}/Enable/6003/{encoded}", headers=AUTH_HEADERS)

    resp = await client.put(f"{_SMS_BASE}/Disable/6003/{encoded}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["sms_enabled"] is False
