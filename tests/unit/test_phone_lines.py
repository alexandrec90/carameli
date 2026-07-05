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


async def test_add_phone_line_real_provider_shape_regression(client) -> None:
    """Regression (A1): the Telnyx provider returns {"provider_sid", "phone_number"} —
    the handler must read provider_sid, not sid. With the old code every live
    /PhoneLine/Add 502'd *after* buying the number."""
    await _create_customer(client, 5000)

    from app.main import app

    # Exact shape returned by TelnyxCarrier.provision_number — no extra keys.
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNreal5000", "phone_number": "+15005550000"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5000, "phone_number": "+15005550000"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["provider_sid"] == "PNreal5000"
    assert body["phone_number"] == "+15005550000"


async def test_add_phone_line_by_area_code(client) -> None:
    await _create_customer(client, 5001)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15005550100"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNtest5001", "phone_number": "+15005550100"}
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
        return_value={"provider_sid": "PNtest5002", "phone_number": "+15025550100"}
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
        return_value={"provider_sid": "PNtest5004", "phone_number": "+15045550100"}
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
        return_value={"provider_sid": "PNtest5005", "phone_number": "+15055550100"}
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
        return_value={"provider_sid": "PNtest5006", "phone_number": "+15065550100"}
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


async def test_add_phone_line_no_area_code_or_number_returns_422(client) -> None:
    await _create_customer(client, 5020)
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5020},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


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
        return_value={"provider_sid": "PNtest5023", "phone_number": "+15235550100"}
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
        return_value={"provider_sid": "PNtest5031", "phone_number": "+15315550100"}
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


# ---------------------------------------------------------------------------
# Toll-free DID provisioning (Feature 1)
# ---------------------------------------------------------------------------


async def test_add_phone_line_toll_free_area_code(client) -> None:
    """Toll-free prefix (800) is accepted and routed to the carrier."""
    await _create_customer(client, 5100)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+18005550100"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNtf5100", "phone_number": "+18005550100"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5100, "area_code": "800"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json()["phone_number"] == "+18005550100"
    app.state.carrier.search_numbers.assert_awaited_once_with("800", 1, country_code="US")


async def test_add_phone_line_toll_free_prefixes_all_accepted(client) -> None:
    """All 7 NANP toll-free prefixes are accepted as valid area codes."""
    toll_free_prefixes = ["800", "833", "844", "855", "866", "877", "888"]
    for i, prefix in enumerate(toll_free_prefixes):
        vs_id = 5110 + i
        await _create_customer(client, vs_id)

        from app.main import app

        number = f"+1{prefix}5550100"
        app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": number}])
        app.state.carrier.provision_number = AsyncMock(
            return_value={"provider_sid": f"PNtf{vs_id}", "phone_number": number}
        )

        resp = await client.post(
            f"{_LINE_BASE}/Add",
            json={"vs_customer_id": vs_id, "area_code": prefix},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 201, f"Failed for prefix {prefix}"
        app.state.carrier.search_numbers.assert_awaited_with(prefix, 1, country_code="US")


# ---------------------------------------------------------------------------
# International DID provisioning (Feature 2)
# ---------------------------------------------------------------------------


async def test_add_phone_line_international_area_code(client) -> None:
    """country_code=GB routes the search to the correct country."""
    await _create_customer(client, 5120)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+441614960000"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNgb5120", "phone_number": "+441614960000"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5120, "area_code": "161", "country_code": "GB"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json()["phone_number"] == "+441614960000"
    app.state.carrier.search_numbers.assert_awaited_once_with("161", 1, country_code="GB")
    app.state.carrier.provision_number.assert_awaited_once_with("+441614960000", country_code="GB")


async def test_add_phone_line_by_number_with_country_code(client) -> None:
    """country_code passed with explicit phone_number is forwarded to provision_number."""
    await _create_customer(client, 5121)

    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNca5121", "phone_number": "+16135550100"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={
            "vs_customer_id": 5121,
            "phone_number": "+16135550100",
            "country_code": "CA",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    app.state.carrier.provision_number.assert_awaited_once_with("+16135550100", country_code="CA")


async def test_add_phone_line_invalid_country_code_returns_422(client) -> None:
    """country_code that is not 2 letters is rejected with 422."""
    await _create_customer(client, 5122)
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5122, "area_code": "415", "country_code": "USA"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_add_phone_line_country_code_lowercased_accepted(client) -> None:
    """Lowercase country_code is auto-uppercased by the validator."""
    await _create_customer(client, 5123)

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15235550100"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": "PNus5123", "phone_number": "+15235550100"}
    )

    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": 5123, "area_code": "523", "country_code": "us"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    app.state.carrier.search_numbers.assert_awaited_once_with("523", 1, country_code="US")


# ---------------------------------------------------------------------------
# PUT /SetAutoAttendant
# ---------------------------------------------------------------------------


async def _provision_line(client, vs_id: int, phone_number: str, area_code: str) -> None:
    await _create_customer(client, vs_id)
    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": phone_number}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNaa{vs_id}", "phone_number": phone_number}
    )
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "area_code": area_code},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def test_set_auto_attendant_enable(client) -> None:
    await _provision_line(client, 5200, "+15205550100", "520")
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 5200,
            "phone_number": "+15205550100",
            "enabled": True,
            "max_digits": 1,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["auto_attendant_enabled"] is True
    assert data["auto_attendant_max_digits"] == 1


async def test_set_auto_attendant_disable(client) -> None:
    await _provision_line(client, 5201, "+15215550100", "521")
    # First enable it
    await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 5201,
            "phone_number": "+15215550100",
            "enabled": True,
            "max_digits": 3,
        },
        headers=AUTH_HEADERS,
    )
    # Then disable — max_digits not required when disabling
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 5201,
            "phone_number": "+15215550100",
            "enabled": False,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["auto_attendant_enabled"] is False


async def test_set_auto_attendant_enabled_without_max_digits_returns_400(client) -> None:
    await _provision_line(client, 5202, "+15225550200", "522")
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 5202,
            "phone_number": "+15225550200",
            "enabled": True,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "max_digits is required when enabled=true"


async def test_set_auto_attendant_unknown_customer_returns_404(client) -> None:
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 99980,
            "phone_number": "+10000000000",
            "enabled": True,
            "max_digits": 1,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_set_auto_attendant_unknown_line_returns_404(client) -> None:
    await _create_customer(client, 5203)
    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={
            "vs_customer_id": 5203,
            "phone_number": "+10000000099",
            "enabled": True,
            "max_digits": 2,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"
