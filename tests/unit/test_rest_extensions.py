"""Carameli-native REST extensions resource (/api/v1/extensions).

Covers the two things the legacy VsExtension verbs got wrong: a range create that could
leave extensions 1..k behind while reporting total failure, and a removal operation
split across two overloads.
"""

from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_BASE = "/api/v1/extensions"


async def _create_customer(client, vs_id: int) -> dict:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()


def _customer_headers(vs_id: int) -> dict[str, str]:
    return {"Authorization": f"Bearer key-{vs_id}"}


# ── create ────────────────────────────────────────────────────────────────────


async def test_create_extension_returns_201_and_resource(client) -> None:
    await _create_customer(client, 7301)
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7301, "extension_number": "100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["extension_number"] == "100"
    assert body["active"] is True
    # Native REST returns the resource, not a success-in-body envelope.
    assert "success" not in body
    assert body["sip_username"].startswith("ext100_")


async def test_create_extension_infers_customer_from_token(client) -> None:
    await _create_customer(client, 7302)
    resp = await client.post(
        _BASE,
        json={"extension_number": "101"},
        headers=_customer_headers(7302),
    )
    assert resp.status_code == 201
    assert resp.json()["extension_number"] == "101"


async def test_create_extension_admin_token_without_customer_returns_400(client) -> None:
    resp = await client.post(_BASE, json={"extension_number": "102"}, headers=AUTH_HEADERS)
    assert resp.status_code == 400


async def test_create_extension_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7303)
    await _create_customer(client, 7304)
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7304, "extension_number": "103"},
        headers=_customer_headers(7303),
    )
    assert resp.status_code == 403


async def test_create_extension_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 99301, "extension_number": "104"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


async def test_create_extension_duplicate_returns_409(client) -> None:
    await _create_customer(client, 7305)
    payload = {"vs_customer_id": 7305, "extension_number": "105"}
    assert (await client.post(_BASE, json=payload, headers=AUTH_HEADERS)).status_code == 201
    assert (await client.post(_BASE, json=payload, headers=AUTH_HEADERS)).status_code == 409


async def test_create_extension_rejects_unknown_field(client) -> None:
    await _create_customer(client, 7306)
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7306, "extension_number": "106", "nope": 1},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_create_extension_missing_auth_returns_401(client) -> None:
    resp = await client.post(_BASE, json={"vs_customer_id": 7307, "extension_number": "107"})
    assert resp.status_code == 401


async def test_create_extension_malformed_auth_returns_401(client) -> None:
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7308, "extension_number": "108"},
        headers={"Authorization": "Bearer not-a-real-key"},
    )
    assert resp.status_code == 401


# ── bulk create ───────────────────────────────────────────────────────────────


async def test_bulk_create_returns_the_whole_range(client) -> None:
    await _create_customer(client, 7310)
    resp = await client.post(
        f"{_BASE}/bulk",
        json={"vs_customer_id": 7310, "start_extension": 200, "end_extension": 204},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    numbers = [e["extension_number"] for e in resp.json()["extensions"]]
    assert numbers == ["200", "201", "202", "203", "204"]


async def test_bulk_create_single_element_range(client) -> None:
    await _create_customer(client, 7311)
    resp = await client.post(
        f"{_BASE}/bulk",
        json={"vs_customer_id": 7311, "start_extension": 210, "end_extension": 210},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    assert len(resp.json()["extensions"]) == 1


async def test_bulk_create_conflict_creates_nothing(client) -> None:
    """The legacy loop created 1..k and then reported total failure; a 409 here must
    mean the range was rejected whole."""
    await _create_customer(client, 7312)
    await client.post(
        _BASE,
        json={"vs_customer_id": 7312, "extension_number": "302"},
        headers=AUTH_HEADERS,
    )
    resp = await client.post(
        f"{_BASE}/bulk",
        json={"vs_customer_id": 7312, "start_extension": 300, "end_extension": 305},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 409

    listed = await client.get(f"{_BASE}?vs_customer_id=7312", headers=AUTH_HEADERS)
    numbers = {e["extension_number"] for e in listed.json()["extensions"]}
    # Only the pre-existing 302 survives — 300 and 301 were never committed.
    assert numbers == {"302"}


async def test_bulk_create_inverted_range_returns_422(client) -> None:
    await _create_customer(client, 7313)
    resp = await client.post(
        f"{_BASE}/bulk",
        json={"vs_customer_id": 7313, "start_extension": 400, "end_extension": 399},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_bulk_create_oversized_range_returns_422(client) -> None:
    await _create_customer(client, 7314)
    resp = await client.post(
        f"{_BASE}/bulk",
        json={"vs_customer_id": 7314, "start_extension": 0, "end_extension": 5000},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_bulk_create_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7315)
    await _create_customer(client, 7316)
    resp = await client.post(
        f"{_BASE}/bulk",
        json={"vs_customer_id": 7316, "start_extension": 500, "end_extension": 501},
        headers=_customer_headers(7315),
    )
    assert resp.status_code == 403


# ── list / get ────────────────────────────────────────────────────────────────


async def test_list_extensions_is_scoped_to_the_customer(client) -> None:
    await _create_customer(client, 7320)
    await _create_customer(client, 7321)
    await client.post(
        _BASE, json={"vs_customer_id": 7320, "extension_number": "600"}, headers=AUTH_HEADERS
    )
    await client.post(
        _BASE, json={"vs_customer_id": 7321, "extension_number": "601"}, headers=AUTH_HEADERS
    )

    resp = await client.get(_BASE, headers=_customer_headers(7320))
    assert resp.status_code == 200
    numbers = [e["extension_number"] for e in resp.json()["extensions"]]
    assert numbers == ["600"]


async def test_get_extension_by_id(client) -> None:
    await _create_customer(client, 7322)
    created = await client.post(
        _BASE, json={"vs_customer_id": 7322, "extension_number": "700"}, headers=AUTH_HEADERS
    )
    ext_id = created.json()["id"]
    resp = await client.get(f"{_BASE}/{ext_id}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["id"] == ext_id


async def test_get_extension_unknown_id_returns_404(client) -> None:
    resp = await client.get(f"{_BASE}/00000000-0000-0000-0000-000000000000", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_get_extension_malformed_id_returns_422(client) -> None:
    resp = await client.get(f"{_BASE}/not-a-uuid", headers=AUTH_HEADERS)
    assert resp.status_code == 422


async def test_get_extension_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7323)
    await _create_customer(client, 7324)
    created = await client.post(
        _BASE, json={"vs_customer_id": 7324, "extension_number": "701"}, headers=AUTH_HEADERS
    )
    resp = await client.get(f"{_BASE}/{created.json()['id']}", headers=_customer_headers(7323))
    assert resp.status_code == 403


# ── patch (the single removal operation) ──────────────────────────────────────


async def test_patch_extension_deactivates(client) -> None:
    await _create_customer(client, 7330)
    created = await client.post(
        _BASE, json={"vs_customer_id": 7330, "extension_number": "800"}, headers=AUTH_HEADERS
    )
    resp = await client.patch(
        f"{_BASE}/{created.json()['id']}", json={"active": False}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["active"] is False


async def test_patch_extension_cannot_reactivate(client) -> None:
    await _create_customer(client, 7331)
    created = await client.post(
        _BASE, json={"vs_customer_id": 7331, "extension_number": "801"}, headers=AUTH_HEADERS
    )
    resp = await client.patch(
        f"{_BASE}/{created.json()['id']}", json={"active": True}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 400


async def test_patch_extension_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7332)
    await _create_customer(client, 7333)
    created = await client.post(
        _BASE, json={"vs_customer_id": 7333, "extension_number": "802"}, headers=AUTH_HEADERS
    )
    resp = await client.patch(
        f"{_BASE}/{created.json()['id']}",
        json={"active": False},
        headers=_customer_headers(7332),
    )
    assert resp.status_code == 403


async def test_patch_extension_unknown_id_returns_404(client) -> None:
    resp = await client.patch(
        f"{_BASE}/00000000-0000-0000-0000-000000000000",
        json={"active": False},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


# ── the legacy tree stays published ───────────────────────────────────────────


async def test_legacy_vsapi_extension_route_still_works(client) -> None:
    """`/vsapi` is not retired by this change — VanillaSoft still calls it."""
    await _create_customer(client, 7340)
    resp = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={"vs_customer_id": 7340, "extension_number": "900"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
