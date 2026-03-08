from __future__ import annotations

import uuid

import pytest

from app.repositories.extension_repo import ExtensionRepo
from tests.conftest import AUTH_HEADERS

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_SCI_ZIP = "/vsapi/1.0.0/PostSCIbyZipCode"
_SCI_OPT = "/vsapi/1.0.0/UpdateSCIUserOption"


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


async def _seed_extension(db_session, customer_id: uuid.UUID, ext_number: str) -> None:
    ext_repo = ExtensionRepo(db_session)
    await ext_repo.create(
        customer_id=customer_id,
        extension_number=ext_number,
        sip_username=f"ext{ext_number}_{str(customer_id)[:8]}",
        sip_credential_sid=None,
        twilio_domain_sid=None,
    )


@pytest.mark.asyncio
async def test_post_sci_by_zip_code(client, db_session) -> None:
    data = await _create_customer(client, 7201)
    await _seed_extension(db_session, uuid.UUID(data["id"]), "500")

    resp = await client.post(
        _SCI_ZIP,
        json={"vs_customer_id": 7201, "extension_number": "500", "zip_code": "90210", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_post_sci_by_zip_code_update(client, db_session) -> None:
    """Second call with same customer/ext/zip should update in place (upsert)."""
    data = await _create_customer(client, 7202)
    await _seed_extension(db_session, uuid.UUID(data["id"]), "501")

    await client.post(
        _SCI_ZIP,
        json={"vs_customer_id": 7202, "extension_number": "501", "zip_code": "10001", "enabled": True},
        headers=AUTH_HEADERS,
    )
    resp = await client.post(
        _SCI_ZIP,
        json={"vs_customer_id": 7202, "extension_number": "501", "zip_code": "10001", "enabled": False},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_post_sci_by_zip_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        _SCI_ZIP,
        json={"vs_customer_id": 99995, "extension_number": "500", "zip_code": "00000", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_post_sci_by_zip_unknown_extension_returns_404(client) -> None:
    await _create_customer(client, 7203)
    resp = await client.post(
        _SCI_ZIP,
        json={"vs_customer_id": 7203, "extension_number": "999", "zip_code": "12345", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_sci_user_option(client, db_session) -> None:
    data = await _create_customer(client, 7204)
    await _seed_extension(db_session, uuid.UUID(data["id"]), "502")

    resp = await client.post(
        _SCI_OPT,
        json={"vs_customer_id": 7204, "extension_number": "502", "enabled": False},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_update_sci_user_option_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        _SCI_OPT,
        json={"vs_customer_id": 99994, "extension_number": "500", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_sci_user_option_unknown_extension_returns_404(client) -> None:
    await _create_customer(client, 7205)
    resp = await client.post(
        _SCI_OPT,
        json={"vs_customer_id": 7205, "extension_number": "999", "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
