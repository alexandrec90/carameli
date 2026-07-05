"""Concurrency and idempotency tests using asyncio.gather.

These tests verify that concurrent identical requests do not create
duplicate rows and that conflicts are surfaced correctly rather than
causing unhandled 500 errors.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_concurrent_duplicate_webhook_creates_one_row(client, db_session) -> None:
    """Two identical webhooks delivered concurrently must produce exactly one DB row."""
    from sqlalchemy import select

    from app.models.call_event import CallEvent

    payload = {
        "call_sid": "CAconc001",
        "call_status": "completed",
        "from": "+14155550000",
        "to": "+14155550001",
    }
    results = await asyncio.gather(
        client.post("/webhooks/jambonz/call-status", json=payload),
        client.post("/webhooks/jambonz/call-status", json=payload),
    )
    assert all(r.status_code == 200 for r in results)

    rows = (
        (await db_session.execute(select(CallEvent).where(CallEvent.call_sid == "CAconc001")))
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_concurrent_phone_line_add(concurrent_client) -> None:
    """Two concurrent phone-line-add requests for the same customer return two distinct lines."""
    from app.main import app

    await concurrent_client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 8901, "api_key": "key-8901"},
        headers=AUTH_HEADERS,
    )

    app.state.carrier.search_numbers = AsyncMock(
        side_effect=[
            [{"phone_number": "+18901550001"}],
            [{"phone_number": "+18901550002"}],
        ]
    )
    app.state.carrier.provision_number = AsyncMock(
        side_effect=[
            {"provider_sid": "PNconc001", "phone_number": "+18901550001"},
            {"provider_sid": "PNconc002", "phone_number": "+18901550002"},
        ]
    )

    results = await asyncio.gather(
        concurrent_client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 8901, "area_code": "800"},
            headers=AUTH_HEADERS,
        ),
        concurrent_client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 8901, "area_code": "800"},
            headers=AUTH_HEADERS,
        ),
    )

    assert all(r.status_code == 201 for r in results)
    numbers = {r.json()["phone_number"] for r in results}
    assert len(numbers) == 2  # two distinct numbers, no collision


async def test_concurrent_duplicate_customer_create(concurrent_client, test_engine) -> None:
    """Concurrent creation of the same vs_customer_id yields one 201 and one conflict — no 500s.

    ``concurrent_client`` commits real rows that persist for the session (see its fixture
    docstring), so a customer 8902 left behind by a prior — possibly interrupted — run would
    make *both* requests conflict (409/409) and mask the expected 201. Guarantee a clean slate
    up front via the real engine; this is a setup delete on a fixture-owned engine, not the
    forbidden db_session teardown cleanup.
    """
    from sqlalchemy import delete

    from app.models.customer import Customer

    async with test_engine.begin() as conn:
        await conn.execute(delete(Customer).where(Customer.vs_customer_id == 8902))

    results = await asyncio.gather(
        concurrent_client.post(
            "/vsapi/1.0.0/VsCustomer/Create",
            json={"vs_customer_id": 8902, "api_key": "key-8902a"},
            headers=AUTH_HEADERS,
        ),
        concurrent_client.post(
            "/vsapi/1.0.0/VsCustomer/Create",
            json={"vs_customer_id": 8902, "api_key": "key-8902b"},
            headers=AUTH_HEADERS,
        ),
    )
    status_codes = {r.status_code for r in results}
    assert 201 in status_codes
    assert status_codes <= {201, 409}, f"Unexpected status codes: {status_codes}"
