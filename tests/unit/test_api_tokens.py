from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_TOK_BASE = "/vsapi/1.0.0/VsToken"


async def _create_customer(client, vs_id: int, api_key: str = "") -> None:
    key = api_key or f"longapikey{vs_id:04d}abcd"
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": key},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def test_list_api_tokens_returns_masked_key(client) -> None:
    await _create_customer(client, 8301, api_key="abcdefgh12345678")
    resp = await client.get(f"{_TOK_BASE}/List/8301", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_customer_id"] == 8301
    assert len(body["tokens"]) == 1
    token = body["tokens"][0]
    # Masked: first 4 + **** + last 4 — raw key must not appear
    assert token["token_masked"] == "abcd****5678"
    assert "abcdefgh12345678" not in token["token_masked"]
    assert token["enabled"] is True


async def test_list_api_tokens_customer_not_found(client) -> None:
    resp = await client.get(f"{_TOK_BASE}/List/839901", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_list_api_tokens_short_key_masked(client) -> None:
    await _create_customer(client, 8302, api_key="short")
    resp = await client.get(f"{_TOK_BASE}/List/8302", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    token = resp.json()["tokens"][0]
    assert token["token_masked"] == "****"
    assert "short" not in token["token_masked"]


async def test_list_api_tokens_isolation(client) -> None:
    await _create_customer(client, 8303, api_key="custA000000key00")
    await _create_customer(client, 8304, api_key="custB000000key00")

    resp_a = await client.get(f"{_TOK_BASE}/List/8303", headers=AUTH_HEADERS)
    resp_b = await client.get(f"{_TOK_BASE}/List/8304", headers=AUTH_HEADERS)

    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    # Different prefixes — confirm they differ
    tok_a = resp_a.json()["tokens"][0]["token_masked"]
    tok_b = resp_b.json()["tokens"][0]["token_masked"]
    assert tok_a != tok_b


async def test_list_api_tokens_no_raw_key_in_response(client) -> None:
    raw_key = "supersecretapikey9999"
    await _create_customer(client, 8305, api_key=raw_key)
    resp = await client.get(f"{_TOK_BASE}/List/8305", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert raw_key not in resp.text
