"""Live Telnyx sandbox integration tests.

These tests use real Telnyx sandbox credentials and are skipped by default.
Enable explicitly with ``TELNYX_SANDBOX=1``.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.repositories.sms_message_repo import SmsMessageRepo
from app.services.providers.carrier.telnyx import TelnyxCarrier

pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.paid,
    pytest.mark.sandbox,
    pytest.mark.skipif(
        os.getenv("TELNYX_SANDBOX") != "1",
        reason="Set TELNYX_SANDBOX=1 to run Telnyx sandbox tests",
    ),
    pytest.mark.skipif(
        not settings.telnyx_api_key,
        reason="TELNYX_API_KEY not set",
    ),
]

# Telnyx has no Twilio-style magic test numbers (+1500555xxxx gets rejected with
# "Invalid source number") — SMS tests need real DIDs owned by the account.
_needs_sms_numbers = pytest.mark.skipif(
    not (settings.telnyx_test_from_number and settings.telnyx_test_to_number),
    reason="Set TELNYX_TEST_FROM_NUMBER and TELNYX_TEST_TO_NUMBER (owned Telnyx DIDs)",
)


def _make_carrier() -> TelnyxCarrier:
    return TelnyxCarrier(
        api_key=settings.telnyx_api_key,
        webhook_base_url=settings.telnyx_webhook_base_url,
    )


@pytest.fixture
async def carrier() -> AsyncIterator[TelnyxCarrier]:
    """Create a real Telnyx carrier client for a test and close it afterward."""
    c = _make_carrier()
    try:
        yield c
    finally:
        await c.aclose()


async def test_search_numbers_returns_results(carrier: TelnyxCarrier) -> None:
    """Telnyx sandbox returns available numbers for a known area code."""
    results = await carrier.search_numbers(area_code="415", count=2)
    assert isinstance(results, list)
    assert len(results) >= 1
    assert all(r["phone_number"].startswith("+") for r in results)


@pytest.mark.chargeable
async def test_provision_and_release_number(carrier: TelnyxCarrier) -> None:
    """Provision and release a sandbox DID (may incur a small sandbox charge).

    A Telnyx DID is a *recurring monthly* charge the instant it is ordered, so the
    release runs in a ``finally``: an assertion failure (or a flaky release) between
    the order and the cleanup must never leave the number on the account accruing a
    monthly fee. Release is best-effort-but-loud -- if it raises, the test fails so
    the leak is surfaced rather than silently billed.
    """
    numbers = await carrier.search_numbers(area_code="415", count=1)
    assert numbers, "No numbers available in sandbox for area 415"

    number = numbers[0]["phone_number"]
    provisioned = await carrier.provision_number(number)
    # Resolve the sid before any assertion so the finally can always release.
    provider_sid = provisioned.get("sid") or provisioned.get("provider_sid")
    try:
        assert provisioned["phone_number"] == number
        assert provider_sid, "Provision response did not include sid/provider_sid"
    finally:
        if provider_sid:
            await carrier.release_number(provider_sid)


@_needs_sms_numbers
async def test_send_sms_sandbox(carrier: TelnyxCarrier) -> None:
    """Send an SMS between the account's own test DIDs and verify no exception."""
    result = await carrier.send_sms(
        from_=settings.telnyx_test_from_number,
        to=settings.telnyx_test_to_number,
        body="Carameli sandbox test",
    )
    assert result is not None


async def test_provision_invalid_number_raises_provider_error(carrier: TelnyxCarrier) -> None:
    """Attempting to provision a non-existent number raises a structured provider error."""
    with pytest.raises(httpx.HTTPStatusError):
        await carrier.provision_number("+10000000000")


async def test_send_sms_invalid_from_raises(carrier: TelnyxCarrier) -> None:
    """Sending SMS from an unprovisionable number raises."""
    with pytest.raises(httpx.HTTPStatusError):
        await carrier.send_sms(from_="+10000000000", to="+15005550007", body="test")


@pytest.mark.chargeable
@_needs_sms_numbers
@pytest.mark.skipif(
    not os.getenv("NGROK_URL"),
    reason="Requires NGROK_URL for live callback testing",
)
async def test_sms_delivery_receipt_schema(
    carrier: TelnyxCarrier,
    db_session: AsyncSession,
) -> None:
    """Send SMS and verify a live delivery receipt updates SmsMessage.delivery_status."""
    result = await carrier.send_sms(
        from_=settings.telnyx_test_from_number,
        to=settings.telnyx_test_to_number,
        body="Carameli sandbox delivery receipt schema test",
    )
    message_sid = str(result.get("sid") or "")
    assert message_sid, "Carrier response missing message SID"

    repo = SmsMessageRepo(db_session)
    await repo.create(
        customer_id=None,
        phone_line_id=None,
        message_sid=message_sid,
        direction="outbound",
        from_number=settings.telnyx_test_from_number,
        to_number=settings.telnyx_test_to_number,
        body="Carameli sandbox delivery receipt schema test",
        delivery_status="queued",
    )

    receipt_status: str | None = None
    for _ in range(20):  # wait up to ~10 seconds
        row = await repo.get_by_message_sid(message_sid)
        if row and row.delivery_status and row.delivery_status != "queued":
            receipt_status = row.delivery_status
            break
        await asyncio.sleep(0.5)

    assert receipt_status is not None, (
        "No delivery receipt observed within 10s. Check ngrok + Telnyx webhook configuration."
    )
