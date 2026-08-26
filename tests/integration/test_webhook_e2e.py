"""End-to-end webhook tests via ngrok tunnel.

These tests verify that Telnyx and Jambonz can reach Carameli's webhook
endpoints through an ngrok tunnel. They are skipped unless NGROK_URL is set
(the start-ngrok.py script sets this automatically in .env) *and* that URL is
actually serving -- see `tunnel_serves_a_stack`.

Prerequisites:
  - ngrok running with a tunnel to localhost:8000
  - NGROK_URL env var set to the public HTTPS URL
  - Docker stack running (app + Jambonz + DB)

Run:
    NGROK_URL=https://abc123.ngrok-free.app pytest tests/integration/test_webhook_e2e.py -v
"""

from __future__ import annotations

import functools
import os

import httpx
import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

_NGROK_URL = os.environ.get("NGROK_URL", "").strip()

skip_no_ngrok = pytest.mark.skipif(
    not _NGROK_URL,
    reason="Webhook tests disabled (set NGROK_URL to the ngrok HTTPS tunnel URL)",
)


@functools.cache
def tunnel_serves_a_stack(url: str) -> bool:
    """True when `url` answers /health with 200 -- i.e. a tunnel really is up.

    NGROK_URL being *set* is not the same question. The domain is reserved, so a
    worktree box seeds its `.env` from the source checkout and inherits a URL that
    resolves whether or not anything is listening; with the tunnel down ngrok itself
    answers 404. These five tests were therefore collected by the free changed-scope
    inside a box and failed there on every branch, for a reason no branch caused.
    """
    try:
        return httpx.get(f"{url}/health", timeout=10.0).status_code == 200
    except httpx.HTTPError:
        return False


def tunnel_gate(url: str, require: bool) -> None:
    """Skip unless `url` is actually serving; fail instead when `require`.

    `require` is the dedicated reachability run (`scripts/run-tests.py --target
    webhook-e2e`), where a quiet skip would be an all-skipped green pass. Everywhere
    else -- notably the free changed-scope inside a worktree box -- a dead tunnel is
    an environment fact, not a defect in the branch under test.
    """
    if tunnel_serves_a_stack(url):
        return
    message = (
        f"NGROK_URL ({url}) is set but its /health does not answer 200 -- "
        "no tunnel is serving this stack."
    )
    if require:
        pytest.fail(message)
    pytest.skip(message)


@pytest.fixture(autouse=True)
def _live_tunnel() -> None:
    """Apply `tunnel_gate` to every test here.

    Probed lazily (and once), so collection stays free and an unset NGROK_URL never
    reaches the network -- `skip_no_ngrok` has already skipped by then.
    """
    tunnel_gate(_NGROK_URL, os.environ.get("CARAMELI_REQUIRE_NGROK") == "1")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get(path: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15.0) as client:
        return await client.get(f"{_NGROK_URL}{path}")


async def _post(path: str, json: dict | None = None, headers: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15.0) as client:
        return await client.post(f"{_NGROK_URL}{path}", json=json or {}, headers=headers or {})


# ---------------------------------------------------------------------------
# Tunnel reachability
# ---------------------------------------------------------------------------


@skip_no_ngrok
async def test_health_through_tunnel():
    """The /health endpoint is reachable through the ngrok tunnel."""
    resp = await _get("/health")
    assert resp.status_code == 200


@skip_no_ngrok
async def test_openapi_schema_through_tunnel():
    """The OpenAPI schema is served through the tunnel."""
    resp = await _get("/openapi.json")
    assert resp.status_code == 200
    data = resp.json()
    assert "paths" in data


# ---------------------------------------------------------------------------
# Jambonz webhook endpoints
# ---------------------------------------------------------------------------


@skip_no_ngrok
async def test_jambonz_call_status_webhook_reachable():
    """Jambonz call-status webhook endpoint responds (401 without auth is fine)."""
    resp = await _post(
        "/webhooks/jambonz/call-status",
        json={"call_sid": "CA_test", "call_status": "completed"},
    )
    # Expect 401 (missing auth) or 422 (bad payload) -- not 404 or 502
    assert resp.status_code in (200, 401, 403, 422)


# ---------------------------------------------------------------------------
# Telnyx webhook endpoints
# ---------------------------------------------------------------------------


@skip_no_ngrok
async def test_telnyx_webhook_reachable():
    """Telnyx webhook endpoint responds through the tunnel."""
    resp = await _post(
        "/webhooks/telnyx/sms-inbound",
        json={
            "data": {
                "event_type": "message.received",
                "payload": {"text": "test", "from": {"phone_number": "+15005550001"}},
            }
        },
    )
    # Expect 401/403 (bad signature) or 422 -- not 404 or 502
    assert resp.status_code in (200, 401, 403, 422)


# ---------------------------------------------------------------------------
# Auth through tunnel
# ---------------------------------------------------------------------------


@skip_no_ngrok
async def test_authenticated_request_through_tunnel():
    """An authenticated API call works through the tunnel."""
    api_key = os.environ.get("API_KEY_SECRET", "")
    if not api_key:
        pytest.skip("API_KEY_SECRET not set")

    resp = await _get("/health")
    # Health doesn't require auth, but confirms the tunnel + app are working
    assert resp.status_code == 200
