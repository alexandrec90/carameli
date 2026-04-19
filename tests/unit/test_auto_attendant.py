from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_INCOMING = "/webhooks/jambonz/incoming-call"

_VS_ID = 7001


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_line(client, vs_id: int, phone_number: str) -> None:
    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": f"PNtest{vs_id}", "phone_number": phone_number}
    )
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "phone_number": phone_number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# PUT /PhoneLine/SetAutoAttendant — happy paths
# ---------------------------------------------------------------------------


async def test_set_auto_attendant_enable(client) -> None:
    """Enabling auto-attendant persists the fields and returns them in the response."""
    await _create_customer(client, 7001)
    await _add_line(client, 7001, "+17001000001")

    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 7001,
            "phone_number": "+17001000001",
            "enabled": True,
            "max_digits": 3,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["auto_attendant_enabled"] is True
    assert body["auto_attendant_max_digits"] == 3


async def test_set_auto_attendant_disable(client) -> None:
    """Disabling auto-attendant clears max_digits."""
    await _create_customer(client, 7002)
    await _add_line(client, 7002, "+17002000001")

    # Enable first
    await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 7002,
            "phone_number": "+17002000001",
            "enabled": True,
            "max_digits": 2,
        },
        headers=AUTH_HEADERS,
    )
    # Then disable
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 7002,
            "phone_number": "+17002000001",
            "enabled": False,
            "max_digits": None,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["auto_attendant_enabled"] is False
    assert body["auto_attendant_max_digits"] is None


async def test_set_auto_attendant_max_digits_boundary(client) -> None:
    """max_digits=9 (max allowed) is accepted."""
    await _create_customer(client, 7003)
    await _add_line(client, 7003, "+17003000001")

    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 7003,
            "phone_number": "+17003000001",
            "enabled": True,
            "max_digits": 9,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["auto_attendant_max_digits"] == 9


# ---------------------------------------------------------------------------
# PUT /PhoneLine/SetAutoAttendant — error paths
# ---------------------------------------------------------------------------


async def test_set_auto_attendant_enabled_without_max_digits_returns_400(client) -> None:
    """enabled=True with max_digits=None must return 400."""
    await _create_customer(client, 7010)
    await _add_line(client, 7010, "+17010000001")

    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={"vs_customer_id": 7010, "phone_number": "+17010000001", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 400
    assert "max_digits" in resp.json()["detail"]


async def test_set_auto_attendant_max_digits_out_of_range_returns_422(client) -> None:
    """max_digits=10 exceeds the 1-9 range and must be rejected with 422."""
    await _create_customer(client, 7011)
    await _add_line(client, 7011, "+17011000001")

    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 7011,
            "phone_number": "+17011000001",
            "enabled": True,
            "max_digits": 10,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_set_auto_attendant_unknown_customer_returns_404(client) -> None:
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={"vs_customer_id": 99980, "phone_number": "+10000000000", "enabled": False},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_set_auto_attendant_unknown_line_returns_404(client) -> None:
    await _create_customer(client, 7012)
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={"vs_customer_id": 7012, "phone_number": "+10000099999", "enabled": False},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"


# ---------------------------------------------------------------------------
# POST /webhooks/jambonz/incoming-call — auto-attendant enabled
# ---------------------------------------------------------------------------


async def test_incoming_call_with_auto_attendant_returns_gather(client) -> None:
    """When auto-attendant is enabled, the webhook returns a gather verb."""
    await _create_customer(client, 7020)
    await _add_line(client, 7020, "+17020000001")

    # Enable auto-attendant
    await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 7020,
            "phone_number": "+17020000001",
            "enabled": True,
            "max_digits": 4,
        },
        headers=AUTH_HEADERS,
    )

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CS-001", "to": "+17020000001", "from": "+12125550100"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "gather"
    assert verbs[0]["numDigits"] == 4
    assert "dtmf-result" in verbs[0]["actionHook"]


async def test_incoming_call_without_auto_attendant_returns_empty(client) -> None:
    """When auto-attendant is off, the webhook returns an empty verb array."""
    await _create_customer(client, 7021)
    await _add_line(client, 7021, "+17021000001")

    # Do NOT enable auto-attendant
    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CS-002", "to": "+17021000001", "from": "+12125550100"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_incoming_call_unknown_number_returns_empty(client) -> None:
    """Unknown DID: fall through with empty verb array."""
    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CS-003", "to": "+19990000000", "from": "+12125550100"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_incoming_call_missing_to_returns_empty(client) -> None:
    """Missing 'to' field: return empty verb array (not an error)."""
    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CS-004", "from": "+12125550100"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_incoming_call_invalid_json_returns_400(client) -> None:
    resp = await client.post(
        _INCOMING,
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
