from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.providers.carrier.telnyx import TelnyxCarrier

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _make_carrier(messaging_profile_id: str = "MPtest001") -> TelnyxCarrier:
    return TelnyxCarrier(
        api_key="test-key",
        webhook_base_url="http://localhost:8000",
        messaging_profile_id=messaging_profile_id,
    )


def _mock_response(status_code: int, json_data: dict) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_error = status_code >= 400
    resp.json.return_value = json_data
    resp.text = str(json_data)
    resp.raise_for_status = MagicMock()
    return resp


# ---------------------------------------------------------------------------
# search_numbers
# ---------------------------------------------------------------------------


async def test_search_numbers_returns_phone_list() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(
        200,
        {
            "data": [
                {"phone_number": "+14155550100"},
                {"phone_number": "+14155550101"},
            ]
        },
    )
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.search_numbers("415", 2)

    assert result == [
        {"phone_number": "+14155550100"},
        {"phone_number": "+14155550101"},
    ]
    carrier._client.get.assert_awaited_once()


async def test_search_numbers_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(400, {"errors": [{"detail": "bad request"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 400"))
    carrier._client.get = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 400"):
        await carrier.search_numbers("415", 2)


# ---------------------------------------------------------------------------
# provision_number
# ---------------------------------------------------------------------------


async def test_provision_number_returns_sid_and_number() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": {"id": "PN123abc", "phone_number": "+14155550100"}})
    carrier._client.post = AsyncMock(return_value=fake_resp)

    result = await carrier.provision_number("+14155550100")

    assert result == {"provider_sid": "PN123abc", "phone_number": "+14155550100"}


async def test_provision_number_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(422, {"errors": [{"detail": "number unavailable"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 422"))
    carrier._client.post = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 422"):
        await carrier.provision_number("+14155550100")


# ---------------------------------------------------------------------------
# release_number
# ---------------------------------------------------------------------------


async def test_release_number_succeeds() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {})
    carrier._client.delete = AsyncMock(return_value=fake_resp)

    await carrier.release_number("PN123abc")

    carrier._client.delete.assert_awaited_once_with("/phone_numbers/PN123abc")


async def test_release_number_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(404, {"errors": [{"detail": "not found"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 404"))
    carrier._client.delete = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 404"):
        await carrier.release_number("PN_missing")


# ---------------------------------------------------------------------------
# send_sms
# ---------------------------------------------------------------------------


async def test_send_sms_returns_sid_and_status() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(
        200,
        {
            "data": {
                "id": "SM999",
                "to": [{"status": "queued"}],
            }
        },
    )
    carrier._client.post = AsyncMock(return_value=fake_resp)

    result = await carrier.send_sms("+14155550100", "+12125550199", "hello")

    assert result["sid"] == "SM999"
    assert result["status"] == "queued"


async def test_send_sms_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(400, {"errors": [{"detail": "invalid from number"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 400"))
    carrier._client.post = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 400"):
        await carrier.send_sms("+1bad", "+12125550199", "hello")


# ---------------------------------------------------------------------------
# enable_sms / disable_sms
# ---------------------------------------------------------------------------


async def test_enable_sms_patches_real_messaging_profile_id() -> None:
    """enable_sms must assign the configured messaging profile, never None."""
    carrier = _make_carrier(messaging_profile_id="MPreal123")
    fake_resp = _mock_response(200, {"data": {}})
    carrier._client.patch = AsyncMock(return_value=fake_resp)

    await carrier.enable_sms("PN123abc")

    carrier._client.patch.assert_awaited_once()
    call_args = carrier._client.patch.call_args
    assert "/phone_numbers/PN123abc" in call_args[0][0]
    assert call_args.kwargs["json"] == {"messaging_profile_id": "MPreal123"}


async def test_enable_sms_unconfigured_profile_raises() -> None:
    """Without TELNYX_MESSAGING_PROFILE_ID, enable_sms fails fast instead of disabling SMS."""
    carrier = _make_carrier(messaging_profile_id="")
    carrier._client.patch = AsyncMock()

    with pytest.raises(ValueError, match="TELNYX_MESSAGING_PROFILE_ID"):
        await carrier.enable_sms("PN123abc")

    carrier._client.patch.assert_not_awaited()


async def test_disable_sms_calls_patch_with_null_profile() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": {}})
    carrier._client.patch = AsyncMock(return_value=fake_resp)

    await carrier.disable_sms("PN123abc")

    carrier._client.patch.assert_awaited_once()
    call_args = carrier._client.patch.call_args
    assert "/phone_numbers/PN123abc" in call_args[0][0]
    assert call_args.kwargs["json"] == {"messaging_profile_id": None}


async def test_enable_sms_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(404, {"errors": [{"detail": "not found"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 404"))
    carrier._client.patch = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 404"):
        await carrier.enable_sms("PN_missing")


# ---------------------------------------------------------------------------
# get_available_area_codes
# ---------------------------------------------------------------------------


async def test_get_available_area_codes_deduplicates_npas() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(
        200,
        {
            "data": [
                {"phone_number": "+14155550100"},
                {"phone_number": "+14155550101"},
                {"phone_number": "+16505550200"},
            ]
        },
    )
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.get_available_area_codes("US", "CA")

    local_npas = [r["area_code"] for r in result if r["number_type"] == "local"]
    assert local_npas == ["415", "650"]
    assert all(r["country"] == "US" for r in result)
    # Toll-free prefixes are always appended for US.
    toll_free_npas = {r["area_code"] for r in result if r["number_type"] == "toll-free"}
    assert toll_free_npas == {"800", "833", "844", "855", "866", "877", "888"}


async def test_get_available_area_codes_no_state() -> None:
    carrier = _make_carrier()
    # +18005550000 starts with toll-free NPA "800"; excluded from local, added as toll-free.
    fake_resp = _mock_response(200, {"data": [{"phone_number": "+18005550000"}]})
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.get_available_area_codes("US", None)

    call_kwargs = carrier._client.get.call_args[1]["params"]
    assert "filter[administrative_area]" not in call_kwargs
    local_codes = [r for r in result if r["number_type"] == "local"]
    assert local_codes == []  # "800" is a toll-free prefix, excluded from local
    toll_free_npas = {r["area_code"] for r in result if r["number_type"] == "toll-free"}
    assert toll_free_npas == {"800", "833", "844", "855", "866", "877", "888"}


# ---------------------------------------------------------------------------
# search_numbers — toll-free routing
# ---------------------------------------------------------------------------


async def test_search_numbers_toll_free_prefix_uses_toll_free_filter() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": [{"phone_number": "+18005550100"}]})
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.search_numbers("800", 1)

    assert result == [{"phone_number": "+18005550100"}]
    call_params = carrier._client.get.call_args[1]["params"]
    assert call_params["filter[number_type]"] == "toll_free"
    assert call_params["filter[national_destination_code]"] == "800"
    assert "filter[country_code]" not in call_params


async def test_search_numbers_local_prefix_uses_ndc_filter() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": [{"phone_number": "+14155550100"}]})
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.search_numbers("415", 1)

    call_params = carrier._client.get.call_args[1]["params"]
    assert "filter[number_type]" not in call_params
    assert call_params["filter[national_destination_code]"] == "415"
    assert call_params["filter[country_code]"] == "US"
    assert result == [{"phone_number": "+14155550100"}]


async def test_search_numbers_international_passes_country_code() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": [{"phone_number": "+442071234567"}]})
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.search_numbers("207", 1, country_code="GB")

    call_params = carrier._client.get.call_args[1]["params"]
    assert call_params["filter[country_code]"] == "GB"
    assert call_params["filter[national_destination_code]"] == "207"
    assert result == [{"phone_number": "+442071234567"}]


# ---------------------------------------------------------------------------
# get_available_area_codes — non-US countries omit toll-free block
# ---------------------------------------------------------------------------


async def test_get_available_area_codes_non_us_no_toll_free() -> None:
    carrier = _make_carrier()
    # "+442071234567"[2:5] == "420" — the NPA extraction is US-centric but the key
    # assertion is that toll-free prefixes are NOT appended for non-US countries.
    fake_resp = _mock_response(200, {"data": [{"phone_number": "+442071234567"}]})
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.get_available_area_codes("GB", None)

    toll_free = [r for r in result if r["number_type"] == "toll-free"]
    assert toll_free == []
    assert any(r["number_type"] == "local" for r in result)


async def test_get_available_area_codes_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(500, {"errors": [{"detail": "server error"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 500"))
    carrier._client.get = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 500"):
        await carrier.get_available_area_codes("US", None)
