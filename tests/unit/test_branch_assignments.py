from __future__ import annotations

import pytest

from app.schemas.customer import CustomerCreate
from app.services import customer_service, extension_service, phone_line_service
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_URL = "/vsapi/1.0.0/Branch/Assign"


async def test_assign_and_unassign_extension_branch(client, db_session) -> None:
    customer = await customer_service.create(
        db_session, CustomerCreate(vs_customer_id=9401, api_key="branch-key-9401")
    )
    extension = await extension_service.create(
        db_session,
        customer.id,
        "201",
        "ext201_branch",
        "client-201",
        "sip.test",
    )

    response = await client.put(
        _URL,
        json={"vsCustomerid": 9401, "branchid": 77, "extension": "201"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "target": "201",
        "target_type": "extension",
        "branch_id": 77,
    }
    await db_session.refresh(extension)
    assert extension.branch_id == 77

    response = await client.put(
        _URL,
        json={"vsCustomerid": 9401, "branchid": None, "extension": "201"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    await db_session.refresh(extension)
    assert extension.branch_id is None


async def test_assign_phone_line_branch_and_enforce_tenant(client, db_session) -> None:
    customer = await customer_service.create(
        db_session, CustomerCreate(vs_customer_id=9402, api_key="branch-key-9402")
    )
    await customer_service.create(
        db_session, CustomerCreate(vs_customer_id=9403, api_key="branch-key-9403")
    )
    line = await phone_line_service.create(db_session, customer.id, "+12125550123", "provider-9402")

    denied = await client.put(
        _URL,
        json={"vsCustomerid": 9402, "branchid": 8, "extension": "+12125550123"},
        headers={"Authorization": "Bearer branch-key-9403"},
    )
    assert denied.status_code == 403

    response = await client.put(
        _URL,
        json={"vsCustomerid": 9402, "branchid": 8, "extension": "+12125550123"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["target_type"] == "phone_line"
    await db_session.refresh(line)
    assert line.branch_id == 8


async def test_assign_branch_rejects_unknown_target(client, db_session) -> None:
    await customer_service.create(
        db_session, CustomerCreate(vs_customer_id=9404, api_key="branch-key-9404")
    )
    response = await client.put(
        _URL,
        json={"vsCustomerid": 9404, "branchid": 1, "extension": "999"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 404
