from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"


async def _create_customer(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
    }
    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


async def test_add_phone_line_by_area_code(client) -> None:
    await _create_customer(client, 5001)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15005550100"}])
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


async def test_get_phone_line(client) -> None:
    await _create_customer(client, 5002)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15025550100"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5002", "phone_number": "+15025550100"}
    )

    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5002, "area_code": "502"},
        headers=AUTH_HEADERS,
    )

    resp = await client.get(f"{_LINE_BASE}/Get/5002/%2B15025550100", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["phone_number"] == "+15025550100"


async def test_get_phone_line_not_found(client) -> None:
    await _create_customer(client, 5003)
    resp = await client.get(f"{_LINE_BASE}/Get/5003/%2B10000000000", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_deactivate_phone_line(client) -> None:
    await _create_customer(client, 5004)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15045550100"}])
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


async def test_get_phone_line_count(client) -> None:
    await _create_customer(client, 5005)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15055550100"}])
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


async def test_update_call_recording(client) -> None:
    await _create_customer(client, 5006)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15065550100"}])
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


# ---------------------------------------------------------------------------
# POST /Add — error paths
# ---------------------------------------------------------------------------


async def test_add_phone_line_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 99970, "area_code": "500"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_add_phone_line_no_area_code_or_number_returns_400(client) -> None:
    await _create_customer(client, 5020)
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5020},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 400
    assert "area_code or phone_number" in resp.json()["detail"]


async def test_add_phone_line_no_numbers_available_returns_400(client) -> None:
    await _create_customer(client, 5021)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[])

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5021, "area_code": "999"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 400


async def test_add_phone_line_carrier_error_returns_502(client) -> None:
    await _create_customer(client, 5022)

    from app.main import app

    app.state.carrier.provision_number = AsyncMock(side_effect=RuntimeError("Telnyx unavailable"))

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5022, "phone_number": "+15225550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502


async def test_add_phone_line_by_explicit_number(client) -> None:
    await _create_customer(client, 5023)

    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5023", "phone_number": "+15235550100"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5023, "phone_number": "+15235550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json()["phone_number"] == "+15235550100"


# ---------------------------------------------------------------------------
# GET /Get — error paths
# ---------------------------------------------------------------------------


async def test_get_phone_line_unknown_customer_returns_404(client) -> None:
    resp = await client.get(f"{_LINE_BASE}/Get/99971/%2B10000000000", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


# ---------------------------------------------------------------------------
# GET /GetCount — error paths
# ---------------------------------------------------------------------------


async def test_get_phone_line_count_unknown_customer_returns_404(client) -> None:
    resp = await client.get(f"{_LINE_BASE}/GetCount/99972", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


# ---------------------------------------------------------------------------
# PUT /Deactivate — error paths
# ---------------------------------------------------------------------------


async def test_deactivate_phone_line_unknown_customer_returns_404(client) -> None:
    resp = await client.put(
        f"{_LINE_BASE}/Deactivate",
        json={"vs_customer_id": 99973, "phone_number": "+10000000000"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_deactivate_phone_line_unknown_line_returns_404(client) -> None:
    await _create_customer(client, 5030)
    resp = await client.put(
        f"{_LINE_BASE}/Deactivate",
        json={"vs_customer_id": 5030, "phone_number": "+10000000003"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"


async def test_deactivate_phone_line_carrier_error_returns_502(client) -> None:
    await _create_customer(client, 5031)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15315550100"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNtest5031", "phone_number": "+15315550100"}
    )
    await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5031, "area_code": "531"},
        headers=AUTH_HEADERS,
    )

    app.state.carrier.release_number = AsyncMock(side_effect=RuntimeError("Telnyx unreachable"))
    resp = await client.put(
        f"{_LINE_BASE}/Deactivate",
        json={"vs_customer_id": 5031, "phone_number": "+15315550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# PUT /UpdateCallRecording — error paths
# ---------------------------------------------------------------------------


async def test_update_recording_unknown_customer_returns_404(client) -> None:
    resp = await client.put(
        f"{_LINE_BASE}/UpdateCallRecording",
        json={"vs_customer_id": 99974, "phone_number": "+10000000000", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_update_recording_unknown_line_returns_404(client) -> None:
    await _create_customer(client, 5040)
    resp = await client.put(
        f"{_LINE_BASE}/UpdateCallRecording",
        json={"vs_customer_id": 5040, "phone_number": "+10000000004", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"
