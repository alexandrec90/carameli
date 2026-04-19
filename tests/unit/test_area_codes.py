from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_get_area_codes_returns_list(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        return_value=[
            {"area_code": "415", "country": "US", "number_type": "local"},
            {"area_code": "212", "country": "US", "number_type": "local"},
        ]
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2
    codes = [item["area_code"] for item in body["area_codes"]]
    assert "415" in codes
    assert "212" in codes
    # number_type is present in each item
    assert all(item["number_type"] == "local" for item in body["area_codes"])


async def test_get_area_codes_includes_toll_free_entries(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        return_value=[
            {"area_code": "415", "country": "US", "number_type": "local"},
            {"area_code": "800", "country": "US", "number_type": "toll-free"},
            {"area_code": "888", "country": "US", "number_type": "toll-free"},
        ]
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 3
    by_code = {item["area_code"]: item for item in body["area_codes"]}
    assert by_code["415"]["number_type"] == "local"
    assert by_code["800"]["number_type"] == "toll-free"
    assert by_code["888"]["number_type"] == "toll-free"


async def test_get_area_codes_empty_result(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(return_value=[])
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 0
    assert body["area_codes"] == []


async def test_get_area_codes_provider_error_returns_502(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        side_effect=Exception("Telnyx unavailable")
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 502


async def test_get_area_codes_filtered_by_state(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        return_value=[{"area_code": "650", "country": "US", "number_type": "local"}]
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes/US/CA", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["area_codes"][0]["area_code"] == "650"
    assert body["area_codes"][0]["number_type"] == "local"

    # Confirm the carrier was called with uppercased country + state.
    app.state.carrier.get_available_area_codes.assert_awaited_once_with(country="US", state="CA")


async def test_get_area_codes_requires_auth(client) -> None:
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes")
    assert resp.status_code == 401
