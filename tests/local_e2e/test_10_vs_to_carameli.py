"""Direction 1 — VanillaLand -> Carameli: the contract ``CarameliClient.cs`` depends on.

These tests speak to the remote Carameli exactly as the .NET ``CarameliClient`` does:
same base URL, same static Bearer key, same routes, same expected JSON envelopes. They
exist because the .NET side deserializes with Newtonsoft into fixed DTOs, and a mismatch
there does not raise — an unexpected envelope leaves the target property ``null`` and the
caller reports a benign-looking "not found". That silent-null failure mode is what these
assertions convert into a loud one.

Everything here is a read. Nothing provisions a number, sends a message, or places a
call, so the suite carries no ``paid`` marker and is safe to run in a loop.
"""

from __future__ import annotations

import httpx
import pytest

from tests.local_e2e.helpers import (
    NGROK_SKIP_HEADER,
    CarameliApi,
    LocalE2EConfig,
    assert_json,
    describe,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_native_api_rejects_a_missing_bearer_key(config: LocalE2EConfig) -> None:
    """No ``Authorization`` header must be rejected, not silently served.

    Establishes that the 200s in the rest of this module are earned by the configured
    key rather than by an endpoint that happens to be open.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{config.carameli_base_url}/api/v1/extensions",
            params={"vs_customer_id": config.vs_customer_id},
            headers=NGROK_SKIP_HEADER,
        )
    assert response.status_code in {401, 403}, (
        f"unauthenticated request to /api/v1/extensions was not rejected: {describe(response)}"
    )


async def test_native_api_rejects_a_wrong_bearer_key(config: LocalE2EConfig) -> None:
    """A syntactically valid but wrong key must be rejected."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{config.carameli_base_url}/api/v1/extensions",
            params={"vs_customer_id": config.vs_customer_id},
            headers={"Authorization": "Bearer not-a-real-key", **NGROK_SKIP_HEADER},
        )
    assert response.status_code in {401, 403}, (
        f"a wrong Bearer key was accepted by /api/v1/extensions: {describe(response)}"
    )


async def test_configured_api_key_is_accepted(
    carameli: CarameliApi, config: LocalE2EConfig
) -> None:
    """The configured key authenticates for the configured customer.

    This is the check that fails when ``CarameliApiKey`` in
    ``AppCode/Vanillasoft.Web/Web.config`` is empty or stale — the single most likely
    reason every VanillaLand-initiated VoIP operation returns a failure response.
    """
    response = await carameli.get(
        carameli.native_url("extensions"),
        params={"vs_customer_id": config.vs_customer_id},
    )
    assert response.status_code == 200, (
        "the configured CARAMELI_API_KEY was not accepted for vs_customer_id="
        f"{config.vs_customer_id}. {describe(response)}"
    )


async def test_extensions_list_matches_the_dotnet_dto(
    carameli: CarameliApi, config: LocalE2EConfig
) -> None:
    """``GET /api/v1/extensions`` returns ``{"extensions": [...]}``, not a bare array.

    ``CarameliClient.FindExtension`` deserializes into ``CarameliExtensionListResponse``
    and reads ``dto.Extensions``. A bare top-level array deserializes to an object whose
    ``Extensions`` list stays empty, so every extension lookup would report "not found"
    while the HTTP call looked perfectly successful.
    """
    response = await carameli.get(
        carameli.native_url("extensions"),
        params={"vs_customer_id": config.vs_customer_id},
    )
    assert response.status_code == 200, describe(response)
    body = assert_json(response, "GET /api/v1/extensions")

    assert isinstance(body, dict), (
        "CarameliExtensionListResponse expects a JSON object with an 'extensions' key; "
        f"got a {type(body).__name__}"
    )
    assert "extensions" in body, f"response has no 'extensions' key: {sorted(body)}"
    assert isinstance(body["extensions"], list), (
        f"'extensions' must be a list, got {type(body['extensions']).__name__}"
    )

    if not body["extensions"]:
        pytest.skip(
            f"customer {config.vs_customer_id} has no extensions on the remote Carameli — "
            "field-level contract not exercised; provision one to cover it"
        )

    # Only the fields the .NET DTO actually binds. Asserting the whole payload would make
    # this test fail on additive, backward-compatible changes it should tolerate.
    required = {"id", "extension_number", "sip_username", "active"}
    first = body["extensions"][0]
    missing = required - set(first)
    assert not missing, (
        f"extension objects are missing fields CarameliExtensionResponse binds: {sorted(missing)}; "
        f"present: {sorted(first)}"
    )


async def test_phone_lines_list_matches_the_dotnet_dto(
    carameli: CarameliApi, config: LocalE2EConfig
) -> None:
    """``GET /api/v1/phone-lines`` returns ``{"phone_lines": [...]}`` with bound fields.

    Same silent-null hazard as extensions: ``FindPhoneLine`` reads ``dto.PhoneLines`` and
    then matches on ``phone_number``, so both the envelope key and that field matter.
    ``EnableSMS``/``DisableSMS`` route through this lookup.
    """
    response = await carameli.get(
        carameli.native_url("phone-lines"),
        params={"vs_customer_id": config.vs_customer_id},
    )
    assert response.status_code == 200, describe(response)
    body = assert_json(response, "GET /api/v1/phone-lines")

    assert isinstance(body, dict) and "phone_lines" in body, (
        "CarameliPhoneLineListResponse expects a JSON object with a 'phone_lines' key; "
        f"got {type(body).__name__} with keys {sorted(body) if isinstance(body, dict) else '-'}"
    )
    assert isinstance(body["phone_lines"], list)

    if not body["phone_lines"]:
        pytest.skip(
            f"customer {config.vs_customer_id} has no phone lines on the remote Carameli — "
            "field-level contract not exercised; provision one to cover it"
        )

    required = {"id", "phone_number", "sms_enabled", "recording_enabled", "active"}
    first = body["phone_lines"][0]
    missing = required - set(first)
    assert not missing, (
        f"phone-line objects are missing fields CarameliPhoneLineResponse binds: {sorted(missing)}; "
        f"present: {sorted(first)}"
    )


async def test_vsapi_tree_is_served_at_the_configured_prefix(carameli: CarameliApi) -> None:
    """The legacy ``/vsapi/1.0.0`` tree answers on the same origin as ``/api/v1``.

    ``CarameliApiBaseUrl`` points at the vsapi tree and the client *derives* the native
    tree from its origin, so a base URL missing the ``/vsapi/1.0.0/`` path (or its
    required trailing slash) breaks the vsapi calls while the native ones keep working —
    a confusingly partial failure. ``GetAreaCodes`` is the cheapest read in that tree.
    """
    response = await carameli.get(carameli.vsapi_url("GetAreaCodes/CA/QC"))
    assert response.status_code != 404, (
        "the /vsapi/1.0.0 tree is not served at this origin — check CarameliApiBaseUrl "
        f"in AppCode/Vanillasoft.Web/Web.config. {describe(response)}"
    )
    assert response.status_code == 200, describe(response)
    assert_json(response, "GET /vsapi/1.0.0/GetAreaCodes/CA/QC")
