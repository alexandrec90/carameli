"""Direction 2 — Carameli -> LegacyCRM: the honest receiver, driven locally.

These tests impersonate the remote Carameli: they build the exact notify payload
``app/services/crm_notify.py`` builds, sign it with the shared secret, and POST
the signed bytes to the local ``CarameliNotifyController``. That controller is
deliberately *synchronous and honest* — 200 means the database write landed, and a
failure carries its real reason in the response body — so a 200 here is a genuine
end-to-end assertion about CRM, not an acknowledgement.

Driving the receiver directly rather than waiting for real telephony is what makes this
free and fast. The tunnel test at the end is the piece that proves the *remote* can
actually reach it.

These tests write rows to the local CRM database. Every synthetic identifier is
prefixed ``LOCALE2E-`` so the rows are trivially identifiable and removable; see the
runbook for the cleanup query.
"""

from __future__ import annotations

import time

import httpx
import pytest

from tests.local_e2e.helpers import (
    NGROK_SKIP_HEADER,
    SIGNATURE_TOLERANCE_SECONDS,
    LocalE2EConfig,
    canonical_body,
    describe,
    incoming_call_payload,
    post_notify,
    signed_headers,
    synthetic_call_id,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

FROM_NUMBER = "+15145550100"
TO_NUMBER = "+15145550101"


def _call_sid() -> str:
    """A tagged but genuinely GUID-shaped call id — see ``synthetic_call_id``."""
    return synthetic_call_id()


async def test_signed_incoming_call_is_accepted_and_persisted(config: LocalE2EConfig) -> None:
    """A well-formed signed IncomingCall returns 200 — meaning the row actually landed.

    This is the load-bearing assertion of the whole integration. Because the receiver is
    synchronous, a 200 is proof of a committed write; anything else carries the real
    reason in the body, which the failure message prints verbatim rather than making you
    go read a log to find out what happened.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
        event_name="callHungup",
    )
    response = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )

    assert response.status_code == 200, (
        "the honest receiver did not persist a valid IncomingCall. The body below is "
        f"CRM's real reason: {describe(response)}"
    )


async def test_duplicate_delivery_is_idempotent(config: LocalE2EConfig) -> None:
    """Redelivering the same event returns 200 without creating a second row.

    Carameli retries every unposted event every 30 s, so redelivery is normal traffic
    rather than an edge case. The insert procs are blind INSERTs; the controller's
    existence check is what stops a retry storm from duplicating call history.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
        event_name="callHungup",
    )

    first = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )
    assert first.status_code == 200, f"first delivery failed: {describe(first)}"

    second = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )
    assert second.status_code == 200, f"redelivery was not accepted: {describe(second)}"
    assert "duplicate" in second.text.lower(), (
        "redelivery was accepted but not recognised as a duplicate, so it very likely "
        f"inserted a second row into tblCMVCallNotification: {describe(second)}"
    )


async def test_wrong_signature_is_rejected(config: LocalE2EConfig) -> None:
    """A signature computed with the wrong secret must be rejected with 401."""
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
    )
    body = canonical_body(payload)
    forged = signed_headers(body, "definitely-not-the-secret")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{config.vs_local_base_url}/carameli/notify/IncomingCall",
            content=body,
            headers=forged,
        )

    assert response.status_code == 401, (
        f"a notify signed with the wrong secret was not rejected: {describe(response)}"
    )


async def test_malformed_signature_header_is_rejected(config: LocalE2EConfig) -> None:
    """A structurally invalid signature header must be rejected, not crash the filter.

    ``CarameliSignatureVerifier`` parses ``t=``/``v1=`` pairs by hand; a header it cannot
    parse has to produce a clean 401 rather than a 500 from an unhandled parse error.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
    )
    response = await post_notify(
        config.vs_local_base_url,
        "IncomingCall",
        payload,
        config.notify_secret,
        signature_override="this-is-not-a-signature",
    )
    assert response.status_code == 401, (
        f"a malformed signature header did not produce a clean 401: {describe(response)}"
    )


async def test_stale_timestamp_is_rejected(config: LocalE2EConfig) -> None:
    """A correctly signed request outside the replay window must be rejected.

    Both sides hard-code a 5-minute tolerance (``SIGNATURE_TOLERANCE_SECONDS`` here,
    ``ReplayWindow`` in ``CarameliSignatureAttribute``). This test also catches a clock
    skew big enough to break live traffic: if the machines disagree by more than the
    window, legitimate notifies get rejected exactly like this.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
    )
    stale = int(time.time()) - (SIGNATURE_TOLERANCE_SECONDS + 120)
    response = await post_notify(
        config.vs_local_base_url,
        "IncomingCall",
        payload,
        config.notify_secret,
        timestamp=stale,
    )
    assert response.status_code == 401, (
        "a signature timestamped outside the replay window was accepted — replay "
        f"protection is not working: {describe(response)}"
    )


async def test_unknown_event_name_is_a_client_error(config: LocalE2EConfig) -> None:
    """An unmappable ``eventName`` returns 400, not 500.

    The distinction is what Carameli's retry loop keys off: 4xx means "retrying cannot
    help", 5xx means "retry once the fault clears". Getting this backwards turns one bad
    payload into an infinite retry.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
        event_name="callTeleported",
    )
    response = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )
    assert response.status_code == 400, (
        f"an unknown eventName should be a 400 (do not retry): {describe(response)}"
    )


async def test_failures_carry_a_readable_reason(config: LocalE2EConfig) -> None:
    """Whatever the receiver rejects, it must say why in the response body.

    That is the entire point of the honest receiver: the error travels back to Carameli
    and lands in ``carameli.log``, instead of dying in a background ``catch`` on a server
    whose logs you cannot read from here.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
        event_name="callTeleported",
    )
    response = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )
    assert response.status_code >= 400
    assert response.text.strip(), (
        "the receiver returned an error with an empty body — the failure reason cannot "
        "reach Carameli's log, which defeats the honest-receiver design"
    )
    assert "callTeleported" in response.text, (
        "the error body does not mention the offending value, so it is not actionable: "
        f"{describe(response)}"
    )


async def test_unbindable_body_is_a_client_error(config: LocalE2EConfig) -> None:
    """A JSON body that cannot bind to ``IncomingCall`` returns 400 rather than 500."""
    body = b"[]"
    headers = signed_headers(body, config.notify_secret)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{config.vs_local_base_url}/carameli/notify/IncomingCall",
            content=body,
            headers=headers,
        )
    assert response.status_code == 400, (
        f"an unbindable body should be a 400, not a 5xx: {describe(response)}"
    )


async def test_remote_carameli_can_reach_the_local_receiver(
    config: LocalE2EConfig, public_vs_base_url: str
) -> None:
    """The same signed notify succeeds through the public tunnel.

    Direct-to-localhost success proves the controller works; only this proves the
    *remote* Carameli can deliver to it. Skips when no tunnel is configured — without one
    the reverse direction is not broken, it is simply not connected yet.
    """
    payload = incoming_call_payload(
        call_sid=_call_sid(),
        vs_customer_id=config.vs_customer_id,
        from_number=FROM_NUMBER,
        to_number=TO_NUMBER,
        event_name="callHungup",
    )
    body = canonical_body(payload)
    headers = {**signed_headers(body, config.notify_secret), **NGROK_SKIP_HEADER}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{public_vs_base_url}/carameli/notify/IncomingCall",
            content=body,
            headers=headers,
        )

    assert response.status_code == 200, (
        "a signed notify through the public tunnel did not land. If the direct local "
        "test passed, the fault is in the tunnel, not in CRM. "
        f"{describe(response)}"
    )
