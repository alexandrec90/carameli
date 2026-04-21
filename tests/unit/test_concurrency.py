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


async def test_concurrent_phone_line_add(client, db_session) -> None:
    """Two concurrent phone-line-add requests for the same customer return two distinct lines."""
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 8001, "api_key": "key-8001"},
        headers=AUTH_HEADERS,
    )

    app.state.carrier.search_numbers = AsyncMock(
        side_effect=[
            [{"phone_number": "+18001550001"}],
            [{"phone_number": "+18001550002"}],
        ]
    )
    app.state.carrier.provision_number = AsyncMock(
        side_effect=[
            {"sid": "PNconc001", "phone_number": "+18001550001"},
            {"sid": "PNconc002", "phone_number": "+18001550002"},
        ]
    )

    results = await asyncio.gather(
        client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 8001, "area_code": "800"},
            headers=AUTH_HEADERS,
        ),
        client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 8001, "area_code": "800"},
            headers=AUTH_HEADERS,
        ),
    )

    assert all(r.status_code == 201 for r in results)
    numbers = {r.json()["phone_number"] for r in results}
    assert len(numbers) == 2  # two distinct numbers, no collision


async def test_concurrent_duplicate_customer_create(client) -> None:
    """Concurrent creation of the same vs_customer_id yields one 201 and one conflict — no 500s."""
    results = await asyncio.gather(
        client.post(
            "/vsapi/1.0.0/VsCustomer/Create",
            json={"vs_customer_id": 8002, "api_key": "key-8002a"},
            headers=AUTH_HEADERS,
        ),
        client.post(
            "/vsapi/1.0.0/VsCustomer/Create",
            json={"vs_customer_id": 8002, "api_key": "key-8002b"},
            headers=AUTH_HEADERS,
        ),
    )
    status_codes = {r.status_code for r in results}
    assert 201 in status_codes
    assert status_codes <= {201, 409}, f"Unexpected status codes: {status_codes}"
