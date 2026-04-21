"""Multi-tenant isolation: customer-scoped API keys cannot read or mutate
another customer's resources."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_customer_with_key(client, vs_id: int, api_key: str) -> dict:
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": vs_id, "api_key": api_key},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


# ─────────────────────────────────────────────────────────────────────────────
# Phone lines
# ─────────────────────────────────────────────────────────────────────────────


async def test_phoneline_cross_customer_denied(client) -> None:
    """Customer B cannot read customer A's phone line count."""
    await _create_customer_with_key(client, 7001, "key-7001")
    await _create_customer_with_key(client, 7002, "key-7002")

    from app.main import app

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+17001550000"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNiso7001", "phone_number": "+17001550000"}
    )
    await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7001, "area_code": "700"},
        headers=AUTH_HEADERS,
    )

    resp = await client.get(
        "/vsapi/1.0.0/PhoneLine/GetCount/7001",
        headers={"Authorization": "Bearer key-7002"},
    )
    assert resp.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Extensions
# ─────────────────────────────────────────────────────────────────────────────


async def test_extension_cross_customer_denied(client) -> None:
    """Customer B cannot list customer A's available extensions."""
    await _create_customer_with_key(client, 7003, "key-7003")
    await _create_customer_with_key(client, 7004, "key-7004")

    resp = await client.get(
        "/vsapi/1.0.0/VsExtension/GetAvailable/7003/100/200",
        headers={"Authorization": "Bearer key-7004"},
    )
    assert resp.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# SMS
# ─────────────────────────────────────────────────────────────────────────────


async def test_sms_cross_customer_denied(client) -> None:
    """Customer B cannot enable SMS on customer A's phone number."""
    await _create_customer_with_key(client, 7005, "key-7005")
    await _create_customer_with_key(client, 7006, "key-7006")

    resp = await client.put(
        "/vsapi/1.0.0/VsMessaging/Sms/Enable/7005/+17005550001",
        headers={"Authorization": "Bearer key-7006"},
    )
    assert resp.status_code == 403
