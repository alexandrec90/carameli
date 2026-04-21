from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_customer(client, vs_id: int, api_key: str) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": api_key,
    }
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json=payload,
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


async def test_missing_token_returns_401(client) -> None:
    resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/1")
    assert resp.status_code == 401


async def test_wrong_token_returns_401(client) -> None:
    resp = await client.get(
        "/vsapi/1.0.0/VsCustomer/Get/1",
        headers={"Authorization": "Bearer definitely-wrong-key"},
    )
    assert resp.status_code == 401


async def test_correct_token_passes_auth(client) -> None:
    # 404 means auth passed — the customer just doesn't exist
    resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/99999", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_customer_token_can_access_own_customer(client) -> None:
    await _create_customer(client, 9101, "cust-key-9101")

    resp = await client.get(
        "/vsapi/1.0.0/VsCustomer/Get/9101",
        headers={"Authorization": "Bearer cust-key-9101"},
    )
    assert resp.status_code == 200
    assert resp.json()["vs_customer_id"] == 9101


async def test_customer_token_cannot_access_other_customer(client) -> None:
    await _create_customer(client, 9102, "cust-key-9102")
    await _create_customer(client, 9103, "cust-key-9103")

    resp = await client.get(
        "/vsapi/1.0.0/VsCustomer/Get/9103",
        headers={"Authorization": "Bearer cust-key-9102"},
    )
    assert resp.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Session endpoint lifecycle
# ─────────────────────────────────────────────────────────────────────────────


async def test_create_session_sets_cookie(client) -> None:
    resp = await client.post("/auth/session")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert "carameli_session" in resp.cookies


async def test_destroy_session_clears_cookie(client) -> None:
    await client.post("/auth/session")  # set cookie first
    resp = await client.delete("/auth/session")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_me_with_bearer_returns_context(client) -> None:
    resp = await client.get("/auth/me", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["authenticated"] is True
    assert data["is_admin"] is True


async def test_me_with_session_cookie_returns_context(client) -> None:
    # Cookie is auto-stored in the httpx client jar after POST /auth/session.
    await client.post("/auth/session")
    resp = await client.get("/auth/me")
    assert resp.status_code == 200
    assert resp.json()["authenticated"] is True


async def test_me_unauthenticated_returns_401(client) -> None:
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


async def test_me_wrong_api_key_returns_401(client) -> None:
    resp = await client.get("/auth/me", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


async def test_me_tampered_cookie_returns_401(client) -> None:
    resp = await client.get("/auth/me", cookies={"carameli_session": "bad.signature"})
    assert resp.status_code == 401
