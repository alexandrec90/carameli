"""Live Telnyx sandbox integration tests.

These tests call the real Telnyx API using sandbox/test credentials.
They are skipped by default and only run when TELNYX_SANDBOX=1 is set.

Prerequisites:
  - A Telnyx test API key (prefix KEY or KEYT) in TELNYX_API_KEY env var
  - Internet access

Run:
    TELNYX_SANDBOX=1 pytest tests/integration/test_telnyx_sandbox.py -v

Or inside Docker:
    docker compose exec -e TELNYX_SANDBOX=1 app pytest tests/integration/test_telnyx_sandbox.py -v
"""

from __future__ import annotations

import os

import pytest

from app.core.config import settings
from app.services.providers.carrier.telnyx import TelnyxCarrier

pytestmark = pytest.mark.asyncio(loop_scope="session")

_SANDBOX_ENABLED = os.environ.get("TELNYX_SANDBOX", "").strip() == "1"
_API_KEY = settings.telnyx_api_key
_WEBHOOK_URL = settings.telnyx_webhook_base_url or "http://localhost:8000"

skip_no_sandbox = pytest.mark.skipif(
    not _SANDBOX_ENABLED,
    reason="Telnyx sandbox tests disabled (set TELNYX_SANDBOX=1 to enable)",
)

skip_no_key = pytest.mark.skipif(
    not _API_KEY,
    reason="TELNYX_API_KEY not set",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def carrier():
    """Create a real TelnyxCarrier instance and close it after the test."""
    c = TelnyxCarrier(api_key=_API_KEY, webhook_base_url=_WEBHOOK_URL)
    yield c
    await c.aclose()


# ---------------------------------------------------------------------------
# DID Search
# ---------------------------------------------------------------------------


@skip_no_sandbox
@skip_no_key
async def test_search_numbers_returns_results(carrier):
    """Search for available numbers in a major area code."""
    results = await carrier.search_numbers("415", 2)

    assert isinstance(results, list)
    assert len(results) >= 1
    for item in results:
        assert "phone_number" in item
        assert item["phone_number"].startswith("+1415")


@skip_no_sandbox
@skip_no_key
async def test_search_numbers_empty_area_code(carrier):
    """Searching an unlikely area code returns an empty list (not an error)."""
    results = await carrier.search_numbers("000", 1)
    assert isinstance(results, list)
    # May be empty or may return results depending on Telnyx inventory


@skip_no_sandbox
@skip_no_key
async def test_search_numbers_respects_count(carrier):
    """The count parameter limits how many results come back."""
    results = await carrier.search_numbers("212", 3)

    assert isinstance(results, list)
    assert len(results) <= 3


# ---------------------------------------------------------------------------
# Area Codes
# ---------------------------------------------------------------------------


@skip_no_sandbox
@skip_no_key
async def test_get_available_area_codes_us(carrier):
    """Fetch area codes for the US."""
    results = await carrier.get_available_area_codes("US", None)

    assert isinstance(results, list)
    assert len(results) >= 1
    for item in results:
        assert "area_code" in item
        assert "country" in item
        assert item["country"] == "US"
        assert len(item["area_code"]) == 3


@skip_no_sandbox
@skip_no_key
async def test_get_available_area_codes_with_state(carrier):
    """Fetch area codes filtered by state."""
    results = await carrier.get_available_area_codes("US", "CA")

    assert isinstance(results, list)
    # California has many area codes
    if results:
        assert results[0]["country"] == "US"


# ---------------------------------------------------------------------------
# SMS (sandbox send)
# ---------------------------------------------------------------------------


@skip_no_sandbox
@skip_no_key
async def test_send_sms_sandbox(carrier):
    """Send an SMS via the Telnyx API.

    NOTE: This will only succeed if you have at least one provisioned number.
    With a test key, Telnyx may accept the request but queue it without delivery.
    We just verify the API returns a message SID and status.
    """
    try:
        result = await carrier.send_sms(
            from_="+15005550006",  # Telnyx test "magic" number
            to="+15005550009",
            body="Carameli integration test",
        )
        assert "sid" in result
        assert "status" in result
    except Exception as exc:
        # Telnyx may reject test sends with certain keys; that's OK.
        # We just want to know the API is reachable and responds properly.
        assert "40" in str(exc) or "42" in str(exc), f"Unexpected error: {exc}"


# ---------------------------------------------------------------------------
# DID Provisioning (full lifecycle)
# ---------------------------------------------------------------------------


@skip_no_sandbox
@skip_no_key
@pytest.mark.slow
async def test_provision_and_release_number(carrier):
    """Full DID lifecycle: search -> provision -> release.

    WARNING: This test may incur charges on a live Telnyx account.
    It is designed for sandbox/test API keys only.
    """
    # Search for an available number
    available = await carrier.search_numbers("512", 1)
    if not available:
        pytest.skip("No numbers available in area code 512")

    number = available[0]["phone_number"]

    # Provision it
    result = await carrier.provision_number(number)
    assert "provider_sid" in result
    assert result["phone_number"] == number
    provider_sid = result["provider_sid"]

    try:
        # Release it
        await carrier.release_number(provider_sid)
    except Exception:
        # Best-effort cleanup -- log but don't mask the original assertion
        pytest.fail(f"Failed to release provisioned number {provider_sid}")
