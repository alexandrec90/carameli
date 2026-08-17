from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.main import app
from app.models.sci_preparation import SciPreparation
from app.schemas.customer import CustomerCreate
from app.services import customer_service, extension_service, phone_line_service
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_PRECALL_URL = "/vsapi/1.0.0/Precall/Add"
_CALL_URL = "/vsapi/1.0.0/VsCall/Initiate"


async def _setup(db_session, vs_customer_id: int):
    customer = await customer_service.create(
        db_session,
        CustomerCreate(vs_customer_id=vs_customer_id, api_key=f"sci-{vs_customer_id}"),
    )
    extension = await extension_service.create(
        db_session,
        customer.id,
        "401",
        f"ext401_{vs_customer_id}",
        f"client-{vs_customer_id}",
        "sip.test",
    )
    selected = await phone_line_service.create(
        db_session, customer.id, "+12125550101", f"line-212-{vs_customer_id}"
    )
    other = await phone_line_service.create(
        db_session, customer.id, "+13055550101", f"line-305-{vs_customer_id}"
    )
    return customer, extension, selected, other


async def _prepare(client, vs_customer_id: int, contact_id: int) -> None:
    response = await client.post(
        _PRECALL_URL,
        json={
            "vsCustomerId": vs_customer_id,
            "fromExtension": "401",
            "uniqueId": contact_id,
            "toTn": "+14155550100",
            "areaCodes": ["646", "212"],
        },
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200, response.text
    assert response.json()["selected_caller_id"] == "+12125550101"


async def test_precall_selects_caller_id_and_is_consumed_once(client, db_session) -> None:
    await _setup(db_session, 9420)
    await _prepare(client, 9420, 50120)
    app.state.engine.initiate_call = AsyncMock(
        return_value={"call_id": "call-sci-9420", "status": "queued"}
    )

    body = {
        "vs_customer_id": 9420,
        "from_number": "+13055550101",
        "destination_number": "+14155550100",
        "extension": "401",
        "contact_id": 50120,
    }
    response = await client.post(_CALL_URL, json=body, headers=AUTH_HEADERS)
    assert response.status_code == 200, response.text
    assert app.state.engine.initiate_call.await_args.kwargs["from_"] == "+12125550101"

    preparation = (
        await db_session.execute(select(SciPreparation).where(SciPreparation.contact_id == 50120))
    ).scalar_one()
    await db_session.refresh(preparation)
    assert preparation.consumed_at is not None

    repeated = await client.post(_CALL_URL, json=body, headers=AUTH_HEADERS)
    assert repeated.status_code == 409
    app.state.engine.initiate_call.assert_awaited_once()


async def test_failed_call_does_not_consume_precall(client, db_session) -> None:
    await _setup(db_session, 9421)
    await _prepare(client, 9421, 50121)
    app.state.engine.initiate_call = AsyncMock(side_effect=RuntimeError("engine unavailable"))
    body = {
        "vs_customer_id": 9421,
        "from_number": "+13055550101",
        "destination_number": "+14155550100",
        "extension": "401",
        "contact_id": 50121,
    }

    failed = await client.post(_CALL_URL, json=body, headers=AUTH_HEADERS)
    assert failed.status_code == 502
    app.state.engine.initiate_call = AsyncMock(
        return_value={"call_id": "call-sci-retry-9421", "status": "queued"}
    )
    retried = await client.post(_CALL_URL, json=body, headers=AUTH_HEADERS)
    assert retried.status_code == 200, retried.text


async def test_precall_rejects_missing_matching_caller_id(client, db_session) -> None:
    await _setup(db_session, 9422)
    response = await client.post(
        _PRECALL_URL,
        json={
            "vsCustomerId": 9422,
            "fromExtension": "401",
            "uniqueId": 50122,
            "toTn": "+14155550100",
            "areaCodes": ["999"],
        },
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 409
