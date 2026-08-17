"""Preflight: is the plumbing between remote Carameli and local VanillaLand even up?

Every test here is a cheap, non-mutating reachability or wiring check. They are numbered
``00`` so they run first: when the plumbing is broken, the contract suites downstream
fail in confusing ways, and a preflight failure names the actual cause.

Nothing here needs a database, a tunnel, or a provider — except the tests that explicitly
skip when their piece is not configured.
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
    incoming_call_payload,
    post_notify,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_remote_carameli_is_healthy(carameli: CarameliApi, config: LocalE2EConfig) -> None:
    """The remote stack answers /health with its dependencies reporting ok.

    ``db``/``jambonz`` are part of the payload, so a Carameli that is *running* but has
    lost Postgres is caught here rather than as a mystifying 500 three tests later.
    """
    response = await carameli.get(f"{config.carameli_base_url}/health")
    assert response.status_code == 200, f"remote /health unreachable: {describe(response)}"
    body = assert_json(response, "remote /health")
    assert body.get("status") == "ok", f"remote Carameli unhealthy: {body}"
    assert body.get("db") == "ok", f"remote Carameli has no database: {body}"


async def test_ngrok_interstitial_is_bypassed(config: LocalE2EConfig) -> None:
    """A browser-looking request must not be answered with ngrok's HTML warning page.

    ngrok's free tier serves that interstitial with **HTTP 200**, so any check that only
    asserts a status code passes on a response that never reached Carameli. This test
    pins the failure mode: with the opt-out header the body is JSON, and the assertion
    helper the rest of the suite uses is proven to reject the HTML case.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        browserish = await client.get(
            f"{config.carameli_base_url}/health",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        skipped = await client.get(
            f"{config.carameli_base_url}/health",
            headers={"User-Agent": "Mozilla/5.0", **NGROK_SKIP_HEADER},
        )

    assert_json(skipped, "remote /health with skip header")

    if "json" not in browserish.headers.get("content-type", "").lower():
        # The tunnel does interpose an interstitial: confirm it is the 200-carrying HTML
        # trap and not something else, so the reason this suite sends the header is
        # documented by a passing test rather than a comment.
        assert browserish.status_code == 200
        assert "html" in browserish.headers.get("content-type", "").lower()


async def test_local_vanillaland_notify_route_is_deployed(config: LocalE2EConfig) -> None:
    """The local VoipApi serves ``carameli/notify/*`` and its auth filter is active.

    An *unsigned* POST must be rejected with 401. Two failure modes this separates:
    404 means the branch's ``CarameliNotifyController`` is not built/deployed into the
    IIS application; 200 would mean ``CarameliSignatureAttribute`` is not running at all
    and the receiver is accepting unauthenticated writes.
    """
    payload = incoming_call_payload(
        call_sid="preflight-unsigned",
        vs_customer_id=config.vs_customer_id,
        from_number="+15145550100",
        to_number="+15145550101",
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{config.vs_local_base_url}/carameli/notify/IncomingCall",
            json=payload,
        )

    assert response.status_code != 404, (
        "carameli/notify/IncomingCall is not deployed on the local VoipApi — "
        f"rebuild the VanillaSoft.VoipApi project into the IIS app. {describe(response)}"
    )
    assert response.status_code == 401, (
        "an unsigned notify must be rejected with 401 by CarameliSignatureAttribute; "
        f"got {describe(response)}"
    )


async def test_notify_secret_is_configured_on_the_receiver(config: LocalE2EConfig) -> None:
    """A correctly signed notify gets past auth, proving both sides share a secret.

    ``CarameliSignatureAttribute`` treats an empty ``CarameliNotifySecret`` appSetting as
    "reject everything", which looks identical to a wrong secret from the outside: both
    are 401. This test is the one that tells you the shared secret is actually wired,
    independently of whether the request then succeeds at the database.
    """
    payload = incoming_call_payload(
        call_sid="preflight-signed",
        vs_customer_id=config.vs_customer_id,
        from_number="+15145550100",
        to_number="+15145550101",
        event_name="callHungup",
    )
    response = await post_notify(
        config.vs_local_base_url, "IncomingCall", payload, config.notify_secret
    )

    assert response.status_code != 401, (
        "a correctly signed notify was rejected — VS_CARAMELI_NOTIFY_SECRET does not "
        "match the CarameliNotifySecret appSetting in "
        "AppCode/VanillaSoft.VoipApi/Web.config (an empty appSetting rejects "
        f"everything). {describe(response)}"
    )


async def test_public_tunnel_reaches_the_same_local_receiver(public_vs_base_url: str) -> None:
    """The public tunnel URL resolves to the local VoipApi, not something else.

    Skips when no tunnel is configured. An unsigned POST through the tunnel must produce
    the same 401 the direct local call produces; anything else means the tunnel points at
    the wrong port or site, which would otherwise surface much later as Carameli's notify
    retries silently piling up.
    """
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            f"{public_vs_base_url}/carameli/notify/IncomingCall",
            json={},
            headers=NGROK_SKIP_HEADER,
        )

    assert response.status_code == 401, (
        "the public tunnel does not reach the local VoipApi's Carameli routes; "
        f"check the tunnel target port and path. {describe(response)}"
    )


async def test_local_elasticsearch_is_reachable(config: LocalE2EConfig) -> None:
    """The local Elasticsearch that NLog ships VanillaSoft logs into is up.

    This is the only channel through which a coding agent on this machine can read
    VanillaSoft-side errors, so its absence is a diagnosis blackout rather than a
    cosmetic problem.
    """
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{config.es_url}/_cluster/health")
    assert response.status_code == 200, (
        f"local Elasticsearch unreachable at {config.es_url} — "
        f"'docker start vanillasoft-es'. {describe(response)}"
    )
    body = assert_json(response, "elasticsearch /_cluster/health")
    assert body.get("status") in {"green", "yellow"}, f"Elasticsearch unhealthy: {body}"
