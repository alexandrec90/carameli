"""Carameli-native REST phone-lines resource (/api/v1/phone-lines).

The PATCH verb replaces four legacy ones (Deactivate, UpdateCallRecording,
SetAutoAttendant, VsMessaging/Sms/Enable|Disable), so most of this file is about that
one handler applying exactly the fields it was sent.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.main import app
from app.services import phone_line_service
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_BASE = "/api/v1/phone-lines"


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


def _stub_carrier(number: str = "+12125551000", sid: str = "sid-1") -> None:
    app.state.carrier.provision_number = AsyncMock(
        return_value={"phone_number": number, "provider_sid": sid}
    )
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": number}])
    app.state.carrier.enable_sms = AsyncMock(return_value=None)
    app.state.carrier.disable_sms = AsyncMock(return_value=None)
    app.state.carrier.release_number = AsyncMock(return_value=None)


async def _create_line(client, vs_id: int, number: str, sid: str) -> dict:
    _stub_carrier(number, sid)
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": vs_id, "phone_number": number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── create ────────────────────────────────────────────────────────────────────


async def test_create_phone_line_by_number(client) -> None:
    await _create_customer(client, 7401)
    _stub_carrier("+12125551001", "sid-7401")
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7401, "phone_number": "+12125551001"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["phone_number"] == "+12125551001"
    assert body["active"] is True
    assert "success" not in body


async def test_create_phone_line_by_area_code(client) -> None:
    await _create_customer(client, 7402)
    _stub_carrier("+14155551002", "sid-7402")
    resp = await client.post(
        _BASE, json={"vs_customer_id": 7402, "area_code": "415"}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 201
    assert resp.json()["phone_number"] == "+14155551002"


async def test_create_phone_line_requires_exactly_one_selector(client) -> None:
    await _create_customer(client, 7403)
    both = await client.post(
        _BASE,
        json={"vs_customer_id": 7403, "phone_number": "+12125551003", "area_code": "212"},
        headers=AUTH_HEADERS,
    )
    neither = await client.post(_BASE, json={"vs_customer_id": 7403}, headers=AUTH_HEADERS)
    assert both.status_code == 422
    assert neither.status_code == 422


async def test_create_phone_line_no_numbers_available_returns_400(client) -> None:
    await _create_customer(client, 7404)
    _stub_carrier()
    app.state.carrier.search_numbers = AsyncMock(return_value=[])
    resp = await client.post(
        _BASE, json={"vs_customer_id": 7404, "area_code": "999"}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 400


async def test_create_phone_line_provider_failure_returns_502(client) -> None:
    await _create_customer(client, 7405)
    _stub_carrier()
    app.state.carrier.provision_number = AsyncMock(side_effect=RuntimeError("carrier down"))
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7405, "phone_number": "+12125551005"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502


async def test_create_phone_line_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7406)
    await _create_customer(client, 7407)
    _stub_carrier()
    resp = await client.post(
        _BASE,
        json={"vs_customer_id": 7407, "phone_number": "+12125551006"},
        headers=_customer_headers(7406),
    )
    assert resp.status_code == 403


async def test_create_phone_line_missing_auth_returns_401(client) -> None:
    resp = await client.post(_BASE, json={"vs_customer_id": 7408, "phone_number": "+1212555"})
    assert resp.status_code == 401


# ── list / get ────────────────────────────────────────────────────────────────


async def test_list_phone_lines_is_scoped_to_the_customer(client) -> None:
    await _create_customer(client, 7410)
    await _create_customer(client, 7411)
    await _create_line(client, 7410, "+12125551010", "sid-7410")
    await _create_line(client, 7411, "+12125551011", "sid-7411")

    resp = await client.get(_BASE, headers=_customer_headers(7410))
    assert resp.status_code == 200
    numbers = [line["phone_number"] for line in resp.json()["phone_lines"]]
    assert numbers == ["+12125551010"]


async def test_get_phone_line_by_id(client) -> None:
    await _create_customer(client, 7412)
    line = await _create_line(client, 7412, "+12125551012", "sid-7412")
    resp = await client.get(f"{_BASE}/{line['id']}", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["id"] == line["id"]


async def test_get_phone_line_unknown_id_returns_404(client) -> None:
    resp = await client.get(f"{_BASE}/00000000-0000-0000-0000-000000000000", headers=AUTH_HEADERS)
    assert resp.status_code == 404


async def test_get_phone_line_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7413)
    await _create_customer(client, 7414)
    line = await _create_line(client, 7414, "+12125551014", "sid-7414")
    resp = await client.get(f"{_BASE}/{line['id']}", headers=_customer_headers(7413))
    assert resp.status_code == 403


# ── patch: one verb replacing four ────────────────────────────────────────────


async def test_patch_toggles_recording_only(client) -> None:
    await _create_customer(client, 7420)
    line = await _create_line(client, 7420, "+12125551020", "sid-7420")
    resp = await client.patch(
        f"{_BASE}/{line['id']}", json={"recording_enabled": True}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recording_enabled"] is True
    # Untouched fields stay put — PATCH is partial, not a replace.
    assert body["sms_enabled"] == line["sms_enabled"]
    assert body["active"] is True
    app.state.carrier.enable_sms.assert_not_called()
    app.state.carrier.release_number.assert_not_called()


async def test_patch_enables_sms_through_the_carrier(client) -> None:
    await _create_customer(client, 7421)
    line = await _create_line(client, 7421, "+12125551021", "sid-7421")
    resp = await client.patch(
        f"{_BASE}/{line['id']}", json={"sms_enabled": True}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["sms_enabled"] is True
    app.state.carrier.enable_sms.assert_awaited_once_with("sid-7421")


async def test_patch_disables_sms_through_the_carrier(client) -> None:
    await _create_customer(client, 7422)
    line = await _create_line(client, 7422, "+12125551022", "sid-7422")
    await client.patch(f"{_BASE}/{line['id']}", json={"sms_enabled": True}, headers=AUTH_HEADERS)
    resp = await client.patch(
        f"{_BASE}/{line['id']}", json={"sms_enabled": False}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["sms_enabled"] is False
    app.state.carrier.disable_sms.assert_awaited_once_with("sid-7422")


async def test_patch_sms_provider_failure_leaves_the_row_untouched(client) -> None:
    await _create_customer(client, 7423)
    line = await _create_line(client, 7423, "+12125551023", "sid-7423")
    app.state.carrier.enable_sms = AsyncMock(side_effect=RuntimeError("carrier down"))
    resp = await client.patch(
        f"{_BASE}/{line['id']}", json={"sms_enabled": True}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 502

    after = await client.get(f"{_BASE}/{line['id']}", headers=AUTH_HEADERS)
    assert after.json()["sms_enabled"] is False


async def test_patch_sets_auto_attendant(client) -> None:
    await _create_customer(client, 7424)
    line = await _create_line(client, 7424, "+12125551024", "sid-7424")
    resp = await client.patch(
        f"{_BASE}/{line['id']}",
        json={"auto_attendant_enabled": True, "auto_attendant_max_digits": 3},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["auto_attendant_enabled"] is True
    assert body["auto_attendant_max_digits"] == 3


async def test_patch_auto_attendant_without_max_digits_returns_422(client) -> None:
    await _create_customer(client, 7425)
    line = await _create_line(client, 7425, "+12125551025", "sid-7425")
    resp = await client.patch(
        f"{_BASE}/{line['id']}",
        json={"auto_attendant_enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


async def test_patch_deactivate_releases_the_did(client) -> None:
    await _create_customer(client, 7426)
    line = await _create_line(client, 7426, "+12125551026", "sid-7426")
    resp = await client.patch(f"{_BASE}/{line['id']}", json={"active": False}, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["active"] is False
    app.state.carrier.release_number.assert_awaited_once_with("sid-7426")


async def test_patch_deactivate_provider_failure_returns_502(client) -> None:
    await _create_customer(client, 7427)
    line = await _create_line(client, 7427, "+12125551027", "sid-7427")
    app.state.carrier.release_number = AsyncMock(side_effect=RuntimeError("carrier down"))
    resp = await client.patch(f"{_BASE}/{line['id']}", json={"active": False}, headers=AUTH_HEADERS)
    assert resp.status_code == 502

    after = await client.get(f"{_BASE}/{line['id']}", headers=AUTH_HEADERS)
    assert after.json()["active"] is True


async def test_patch_cannot_reactivate(client) -> None:
    await _create_customer(client, 7428)
    line = await _create_line(client, 7428, "+12125551028", "sid-7428")
    resp = await client.patch(f"{_BASE}/{line['id']}", json={"active": True}, headers=AUTH_HEADERS)
    assert resp.status_code == 422


async def test_patch_applies_several_fields_in_one_request(client) -> None:
    """The point of collapsing four verbs: one round trip sets them all."""
    await _create_customer(client, 7429)
    line = await _create_line(client, 7429, "+12125551029", "sid-7429")
    resp = await client.patch(
        f"{_BASE}/{line['id']}",
        json={
            "sms_enabled": True,
            "recording_enabled": True,
            "auto_attendant_enabled": True,
            "auto_attendant_max_digits": 2,
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sms_enabled"] is True
    assert body["recording_enabled"] is True
    assert body["auto_attendant_enabled"] is True
    assert body["auto_attendant_max_digits"] == 2


async def test_patch_empty_body_returns_422(client) -> None:
    await _create_customer(client, 7430)
    line = await _create_line(client, 7430, "+12125551030", "sid-7430")
    resp = await client.patch(f"{_BASE}/{line['id']}", json={}, headers=AUTH_HEADERS)
    assert resp.status_code == 422


async def test_patch_unknown_field_returns_422(client) -> None:
    await _create_customer(client, 7431)
    line = await _create_line(client, 7431, "+12125551031", "sid-7431")
    resp = await client.patch(f"{_BASE}/{line['id']}", json={"nope": True}, headers=AUTH_HEADERS)
    assert resp.status_code == 422


async def test_patch_cross_tenant_returns_403(client) -> None:
    await _create_customer(client, 7432)
    await _create_customer(client, 7433)
    line = await _create_line(client, 7433, "+12125551033", "sid-7433")
    resp = await client.patch(
        f"{_BASE}/{line['id']}",
        json={"recording_enabled": True},
        headers=_customer_headers(7432),
    )
    assert resp.status_code == 403


async def test_patch_unknown_id_returns_404(client) -> None:
    resp = await client.patch(
        f"{_BASE}/00000000-0000-0000-0000-000000000000",
        json={"recording_enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404


# ── the legacy tree stays published ───────────────────────────────────────────


async def test_acquire_did_rejects_a_request_with_no_selector() -> None:
    """The schemas forbid it, but `acquire_did` is reachable from both trees and must
    not fall through to `search_numbers(None, ...)`."""
    with pytest.raises(ValueError, match="either phone_number or area_code"):
        await phone_line_service.acquire_did(
            MagicMock(), phone_number=None, area_code=None, country_code="US"
        )


async def test_legacy_vsapi_phone_line_route_still_works(client) -> None:
    await _create_customer(client, 7440)
    _stub_carrier("+12125551040", "sid-7440")
    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7440, "phone_number": "+12125551040"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def test_legacy_vsapi_phone_line_by_area_code_still_works(client) -> None:
    """`acquire_did` now backs both trees — the area-code branch must still work."""
    await _create_customer(client, 7441)
    _stub_carrier("+14155551041", "sid-7441")
    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7441, "area_code": "415"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    assert resp.json()["phone_number"] == "+14155551041"
