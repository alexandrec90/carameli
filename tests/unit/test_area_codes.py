from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS


@pytest.mark.asyncio
async def test_get_area_codes_returns_list(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        return_value=[
            {"area_code": "415", "country": "US"},
            {"area_code": "212", "country": "US"},
        ]
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2
    codes = [item["area_code"] for item in body["area_codes"]]
    assert "415" in codes
    assert "212" in codes


@pytest.mark.asyncio
async def test_get_area_codes_empty_result(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(return_value=[])
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 0
    assert body["area_codes"] == []


@pytest.mark.asyncio
async def test_get_area_codes_provider_error_returns_502(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        side_effect=Exception("Telnyx unavailable")
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes", headers=AUTH_HEADERS)
    assert resp.status_code == 502


@pytest.mark.asyncio
async def test_get_area_codes_filtered_by_state(client) -> None:
    from app.main import app

    app.state.carrier.get_available_area_codes = AsyncMock(
        return_value=[{"area_code": "650", "country": "US"}]
    )
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes/US/CA", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["area_codes"][0]["area_code"] == "650"

    # Confirm the carrier was called with uppercased country + state.
    app.state.carrier.get_available_area_codes.assert_awaited_once_with(
        country="US", state="CA"
    )


@pytest.mark.asyncio
async def test_get_area_codes_requires_auth(client) -> None:
    resp = await client.get("/vsapi/1.0.0/GetAreaCodes")
    assert resp.status_code == 401
