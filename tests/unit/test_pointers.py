from __future__ import annotations

import uuid

import pytest

from app.repositories.extension_repo import ExtensionRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from tests.conftest import AUTH_HEADERS

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_ADD_PTR = "/vsapi/1.0.0/AddPointerToExtension"
_DEL_PTR = "/vsapi/1.0.0/DeletePointerToExtension"


async def _create_customer(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
    }
    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


async def _seed_line_and_ext(
    db_session, customer_id: uuid.UUID, phone_number: str, ext_number: str
) -> None:
    """Directly create a phone line and extension, bypassing the carrier mock."""
    line_repo = PhoneLineRepo(db_session)
    await line_repo.create(
        customer_id=customer_id,
        phone_number=phone_number,
        provider_sid=f"PN{phone_number[-7:]}",
    )
    ext_repo = ExtensionRepo(db_session)
    await ext_repo.create(
        customer_id=customer_id,
        extension_number=ext_number,
        sip_username=f"ext{ext_number}_{str(customer_id)[:8]}",
        sip_credential_sid=None,
        sip_domain_sid=None,
    )


@pytest.mark.asyncio
async def test_add_pointer(client, db_session) -> None:
    data = await _create_customer(client, 7101)
    customer_id = uuid.UUID(data["id"])
    await _seed_line_and_ext(db_session, customer_id, "+17105550101", "400")

    resp = await client.post(
        _ADD_PTR,
        json={
            "vs_customer_id": 7101,
            "phone_number": "+17105550101",
            "extension_number": "400",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_add_pointer_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        _ADD_PTR,
        json={
            "vs_customer_id": 99996,
            "phone_number": "+10000000001",
            "extension_number": "400",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_add_pointer_unknown_line_returns_404(client, db_session) -> None:
    data = await _create_customer(client, 7102)
    customer_id = uuid.UUID(data["id"])
    ext_repo = ExtensionRepo(db_session)
    await ext_repo.create(
        customer_id=customer_id,
        extension_number="401",
        sip_username=f"ext401_{str(customer_id)[:8]}",
        sip_credential_sid=None,
        sip_domain_sid=None,
    )

    resp = await client.post(
        _ADD_PTR,
        json={
            "vs_customer_id": 7102,
            "phone_number": "+10000000002",
            "extension_number": "401",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_add_pointer_unknown_extension_returns_404(client, db_session) -> None:
    data = await _create_customer(client, 7103)
    customer_id = uuid.UUID(data["id"])
    line_repo = PhoneLineRepo(db_session)
    await line_repo.create(
        customer_id=customer_id,
        phone_number="+17135550103",
        provider_sid="PNtest7103",
    )

    resp = await client.post(
        _ADD_PTR,
        json={
            "vs_customer_id": 7103,
            "phone_number": "+17135550103",
            "extension_number": "999",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_pointer(client, db_session) -> None:
    data = await _create_customer(client, 7104)
    customer_id = uuid.UUID(data["id"])
    await _seed_line_and_ext(db_session, customer_id, "+17145550104", "402")

    payload = {
        "vs_customer_id": 7104,
        "phone_number": "+17145550104",
        "extension_number": "402",
    }
    await client.post(_ADD_PTR, json=payload, headers=AUTH_HEADERS)

    resp = await client.request("DELETE", _DEL_PTR, json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_delete_pointer_not_found_returns_404(client, db_session) -> None:
    data = await _create_customer(client, 7105)
    customer_id = uuid.UUID(data["id"])
    await _seed_line_and_ext(db_session, customer_id, "+17155550105", "403")

    # No pointer was added — delete should 404.
    resp = await client.request(
        "DELETE",
        _DEL_PTR,
        json={
            "vs_customer_id": 7105,
            "phone_number": "+17155550105",
            "extension_number": "403",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
