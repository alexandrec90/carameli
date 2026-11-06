"""E2E: a request crosses the real stack and comes back with what Postgres stored.

`/health` touches no database, so the Playwright suite passes against a backend with no
tables at all. These go through the published app port, then FastAPI, PgBouncer and a
schema Alembic built from nothing, which is what the rest of `tests/integration/`
replaces with an ASGI transport and a held-open transaction.

They create rows, so they run only on the throwaway stack `E2E_API_KEY` names, which
`scripts/e2e.py` starts. `local` keeps them out of every other run, and an unset key is a
failure rather than a skip because nothing else selects this file.

Run:
    python scripts/e2e.py tests/integration/test_stack_e2e.py
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Generator

import httpx
import pytest

pytestmark = pytest.mark.local

CREATE = "/vsapi/1.0.0/VsCustomer/Create"
PHONE_LINES = "/vsapi/1.0.0/VsCustomer/GetPhoneLines/{customer}"


@pytest.fixture(scope="module")
def backend_url() -> str:
    url = os.environ.get("E2E_BACKEND_URL", "")
    if not url:
        pytest.fail("E2E_BACKEND_URL is unset: run this through scripts/e2e.py")
    return url


@pytest.fixture(scope="module")
def backend(backend_url: str) -> Generator[httpx.Client, None, None]:
    """An HTTP client on the throwaway stack, carrying its API key."""
    key = os.environ.get("E2E_API_KEY", "")
    if not key:
        pytest.fail("E2E_API_KEY is unset: run this through scripts/e2e.py")
    headers = {"Authorization": f"Bearer {key}"}
    with httpx.Client(base_url=backend_url, headers=headers, timeout=30.0) as client:
        yield client


@pytest.fixture
def customer_id() -> int:
    """An id no earlier test created, in the range the API accepts."""
    return secrets.randbelow(2**30) + 1


def test_a_created_customer_is_read_back_from_the_database(
    backend: httpx.Client, customer_id: int
) -> None:
    created = backend.post(CREATE, json={"vs_customer_id": customer_id})
    assert created.status_code == 201, created.text

    lines = backend.get(PHONE_LINES.format(customer=customer_id))

    assert lines.status_code == 200, lines.text
    assert lines.json() == []


def test_creating_the_same_customer_twice_is_refused_by_the_real_constraint(
    backend: httpx.Client, customer_id: int
) -> None:
    assert backend.post(CREATE, json={"vs_customer_id": customer_id}).status_code == 201

    again = backend.post(CREATE, json={"vs_customer_id": customer_id})

    assert again.status_code == 409, again.text


def test_a_request_without_the_key_is_refused(backend_url: str) -> None:
    refused = httpx.post(f"{backend_url}{CREATE}", json={"vs_customer_id": 1}, timeout=30.0)

    assert refused.status_code in (401, 403), refused.text
