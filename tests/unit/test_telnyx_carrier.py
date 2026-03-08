from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.providers.carrier.telnyx import TelnyxCarrier


def _make_carrier() -> TelnyxCarrier:
    return TelnyxCarrier(api_key="test-key", webhook_base_url="http://localhost:8000")


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


@pytest.mark.asyncio
async def test_search_numbers_returns_phone_list() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {
        "data": [
            {"phone_number": "+14155550100"},
            {"phone_number": "+14155550101"},
        ]
    })
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.search_numbers("415", 2)

    assert result == [
        {"phone_number": "+14155550100"},
        {"phone_number": "+14155550101"},
    ]
    carrier._client.get.assert_awaited_once()


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_provision_number_returns_sid_and_number() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {
        "data": {"id": "PN123abc", "phone_number": "+14155550100"}
    })
    carrier._client.post = AsyncMock(return_value=fake_resp)

    result = await carrier.provision_number("+14155550100")

    assert result == {"provider_sid": "PN123abc", "phone_number": "+14155550100"}


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_release_number_succeeds() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {})
    carrier._client.delete = AsyncMock(return_value=fake_resp)

    await carrier.release_number("PN123abc")

    carrier._client.delete.assert_awaited_once_with("/phone_numbers/PN123abc")


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_send_sms_returns_sid_and_status() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {
        "data": {
            "id": "SM999",
            "to": [{"status": "queued"}],
        }
    })
    carrier._client.post = AsyncMock(return_value=fake_resp)

    result = await carrier.send_sms("+14155550100", "+12125550199", "hello")

    assert result["sid"] == "SM999"
    assert result["status"] == "queued"


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_enable_sms_calls_patch() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": {}})
    carrier._client.patch = AsyncMock(return_value=fake_resp)

    await carrier.enable_sms("PN123abc")

    carrier._client.patch.assert_awaited_once()
    call_args = carrier._client.patch.call_args
    assert "/phone_numbers/PN123abc" in call_args[0][0]


@pytest.mark.asyncio
async def test_disable_sms_calls_patch() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": {}})
    carrier._client.patch = AsyncMock(return_value=fake_resp)

    await carrier.disable_sms("PN123abc")

    carrier._client.patch.assert_awaited_once()
    call_args = carrier._client.patch.call_args
    assert "/phone_numbers/PN123abc" in call_args[0][0]


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_get_available_area_codes_deduplicates_npas() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {
        "data": [
            {"phone_number": "+14155550100"},
            {"phone_number": "+14155550101"},
            {"phone_number": "+16505550200"},
        ]
    })
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.get_available_area_codes("US", "CA")

    npas = [r["area_code"] for r in result]
    assert npas == ["415", "650"]
    assert all(r["country"] == "US" for r in result)


@pytest.mark.asyncio
async def test_get_available_area_codes_no_state() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(200, {"data": [{"phone_number": "+18005550000"}]})
    carrier._client.get = AsyncMock(return_value=fake_resp)

    result = await carrier.get_available_area_codes("US", None)

    assert result == [{"area_code": "800", "country": "US"}]
    call_kwargs = carrier._client.get.call_args[1]["params"]
    assert "filter[administrative_area]" not in call_kwargs


@pytest.mark.asyncio
async def test_get_available_area_codes_raises_on_error() -> None:
    carrier = _make_carrier()
    fake_resp = _mock_response(500, {"errors": [{"detail": "server error"}]})
    fake_resp.raise_for_status = MagicMock(side_effect=Exception("HTTP 500"))
    carrier._client.get = AsyncMock(return_value=fake_resp)

    with pytest.raises(Exception, match="HTTP 500"):
        await carrier.get_available_area_codes("US", None)
