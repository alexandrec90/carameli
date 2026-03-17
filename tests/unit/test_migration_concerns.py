from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.did_pointer import DidPointer
from app.models.sci_rule import SciRule
from app.repositories.extension_repo import ExtensionRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"


async def _create_customer(client, vs_id: int, include_api_key: bool = True) -> dict:
    payload: dict[str, str | int] = {
        "vs_customer_id": vs_id,
    }
    if include_api_key:
        payload["api_key"] = f"key-{vs_id}"

    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


async def test_create_customer_without_api_key_generates_one(client) -> None:
    body = await _create_customer(client, 8101, include_api_key=False)

    assert body["vs_customer_id"] == 8101
    assert isinstance(body["api_key"], str)
    assert len(body["api_key"]) >= 20


async def test_voicemail_drop_rejects_invalid_payload(client) -> None:
    resp = await client.post(
        "/vsapi/1.0.0/VsMessageDrop",
        json={
            "vs_customer_id": 8102,
            "extension": "+14155550000",
            "msg_drop_number": "123",
            "audio_url": "",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 422


async def test_add_pointer_rejects_area_code_style_input(client) -> None:
    resp = await client.post(
        "/vsapi/1.0.0/AddPointerToExtension",
        json={
            "vs_customer_id": 8103,
            "phone_number": "415",
            "extension_number": "101",
        },
        headers=AUTH_HEADERS,
    )

    assert resp.status_code == 422


async def test_post_sci_by_zip_code_is_upsert_not_duplicate(client, db_session) -> None:
    customer = await _create_customer(client, 8104)
    customer_id = uuid.UUID(customer["id"])

    ext_repo = ExtensionRepo(db_session)
    ext = await ext_repo.create(
        customer_id=customer_id,
        extension_number="201",
        sip_username="ext201_test8104",
        sip_credential_sid="CRtest8104",
        sip_domain_sid="SDtest8104",
    )

    url = "/vsapi/1.0.0/PostSCIbyZipCode"
    first = await client.post(
        url,
        json={
            "vs_customer_id": 8104,
            "extension_number": "201",
            "zip_code": "94105",
            "enabled": True,
        },
        headers=AUTH_HEADERS,
    )
    assert first.status_code == 200

    second = await client.post(
        url,
        json={
            "vs_customer_id": 8104,
            "extension_number": "201",
            "zip_code": "94105",
            "enabled": False,
        },
        headers=AUTH_HEADERS,
    )
    assert second.status_code == 200

    result = await db_session.execute(
        select(SciRule).where(
            SciRule.customer_id == customer_id,
            SciRule.extension_id == ext.id,
            SciRule.zip_code == "94105",
        )
    )
    rows = result.scalars().all()

    assert len(rows) == 1
    assert rows[0].enabled is False


async def test_add_pointer_same_mapping_is_idempotent(client, db_session) -> None:
    customer = await _create_customer(client, 8105)
    customer_id = uuid.UUID(customer["id"])

    line_repo = PhoneLineRepo(db_session)
    phone_line = await line_repo.create(
        customer_id=customer_id,
        phone_number="+14155558105",
        provider_sid="PNtest8105",
    )

    ext_repo = ExtensionRepo(db_session)
    await ext_repo.create(
        customer_id=customer_id,
        extension_number="301",
        sip_username="ext301_test8105",
        sip_credential_sid="CRtest8105",
        sip_domain_sid="SDtest8105",
    )

    payload = {
        "vs_customer_id": 8105,
        "phone_number": "+14155558105",
        "extension_number": "301",
    }

    first = await client.post(
        "/vsapi/1.0.0/AddPointerToExtension",
        json=payload,
        headers=AUTH_HEADERS,
    )
    assert first.status_code == 200

    second = await client.post(
        "/vsapi/1.0.0/AddPointerToExtension",
        json=payload,
        headers=AUTH_HEADERS,
    )
    assert second.status_code == 200

    result = await db_session.execute(
        select(DidPointer).where(
            DidPointer.phone_line_id == phone_line.id,
        )
    )
    rows = result.scalars().all()

    assert len(rows) == 1
