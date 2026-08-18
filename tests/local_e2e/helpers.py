"""Pure helpers for the local integration suite (``tests/local_e2e/``).

This suite exists for the *inverted* topology: **Carameli runs remotely** (reached over
an ngrok tunnel) and **VanillaLand runs locally** in IIS. That is the mirror image of
``tests/live_e2e/``, which assumes Carameli is local and VanillaSoft is remote staging,
tails ``logs/runtime/carameli.log`` on the local box, and spends real telephony money.

Design constraints that follow from the topology:

- **No ``app.*`` imports.** Carameli's Python is not running on this machine; there is no
  Postgres, no Redis, and no installed project environment. Everything here is stdlib +
  ``httpx`` so the suite runs with nothing but a throwaway interpreter.
- **No telephony.** Every assertion is HTTP-contract or database-write shaped. Nothing in
  this suite places a call or sends an SMS, so it is *not* marked ``paid`` and can be run
  as often as you like.
- **The signing algorithm is duplicated, on purpose.** ``sign_payload`` below is a
  byte-for-byte reimplementation of ``app.services.vanillasoft_notify.sign_payload``. If
  it were imported, a bug that changed both sides at once would go unnoticed; as an
  independent implementation it also cross-checks the C# verifier
  (``CarameliSignatureVerifier``) in the VanillaLand repo. ``tests/unit/
  test_local_e2e_helpers.py`` pins it against a fixed vector so the duplicate cannot
  silently drift.

Environment contract (see ``.env.local-e2e.example`` and
``docs/operations/local-integration-testing.md``):

| Var | Required | Meaning |
| --- | --- | --- |
| ``RUN_LOCAL_E2E`` | yes | ``1`` to enable the suite; otherwise every test skips |
| ``CARAMELI_BASE_URL`` | yes | Remote Carameli public base (the ngrok URL), no trailing slash |
| ``CARAMELI_API_KEY`` | yes | Bearer key for a dedicated E2E customer on the remote |
| ``CARAMELI_VS_CUSTOMER_ID`` | yes | That customer's ``vs_customer_id`` (an integer) |
| ``VS_LOCAL_BASE_URL`` | yes | Local VoIP-receiver base, e.g. ``http://localhost:8021/voip`` |
| ``VS_CARAMELI_NOTIFY_SECRET`` | yes | Must equal the remote's ``CARAMELI_NOTIFY_SECRET`` |
| ``VS_PUBLIC_BASE_URL`` | no | Public tunnel to the *same* local VoipApi; reverse-direction tests skip without it |
| ``VS_WEBHOOK_SECRET`` | no | The remote's ``VANILLASOFT_WEBHOOK_SECRET``; enables the ``/webhooks/vs-log`` test |
| ``ES_URL`` | no | Local Elasticsearch (default ``http://localhost:9200``) |
| ``ES_INDEX`` | no | NLog index (default ``vanillasoft_dev.events``) |
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

# ngrok's free tier answers browser-looking requests with an HTML interstitial **carrying
# HTTP 200**, so a bare status assertion passes on a page that never reached Carameli.
# Every request this suite makes carries the opt-out header, and `assert_json` re-checks
# the response really is JSON. See test_00_preflight.test_ngrok_interstitial_is_bypassed.
NGROK_SKIP_HEADER = {"ngrok-skip-browser-warning": "1"}

SIGNATURE_HEADER = "X-Carameli-Signature"

# Mirrors SIGNATURE_TOLERANCE_SECONDS in app/services/vanillasoft_notify.py and the
# 5-minute ReplayWindow in CarameliSignatureAttribute.cs. Kept as a literal because the
# point of this suite is to catch the two drifting apart.
SIGNATURE_TOLERANCE_SECONDS = 300

REQUIRED_ENV = (
    "CARAMELI_BASE_URL",
    "CARAMELI_API_KEY",
    "CARAMELI_VS_CUSTOMER_ID",
    "VS_LOCAL_BASE_URL",
    "VS_CARAMELI_NOTIFY_SECRET",
)

VSAPI_PREFIX = "/vsapi/1.0.0"
NATIVE_PREFIX = "/api/v1"

# The prefix Carameli posts notifies under once VANILLASOFT_NOTIFY_PREFIX is flipped off
# its "notify" default. The whole point of the honest receiver is that these routes are
# Carameli-only, so the suite always drives them and never the legacy ones.
NOTIFY_PREFIX = "carameli/notify"


# --------------------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------------------


def load_dotenv(path: Path) -> None:
    """Load ``KEY=VALUE`` lines from *path* into ``os.environ`` without overwriting.

    A deliberately tiny parser rather than a dependency: this suite must run from a bare
    interpreter, and the file it reads is a local, hand-written config. Real environment
    variables win so a one-off ``VS_PUBLIC_BASE_URL=... pytest ...`` overrides the file.
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class LocalE2EConfig:
    """Resolved configuration for one local-integration run."""

    carameli_base_url: str
    carameli_api_key: str
    vs_customer_id: int
    vs_local_base_url: str
    notify_secret: str
    vs_public_base_url: str | None
    vs_webhook_secret: str | None
    es_url: str
    es_index: str

    @classmethod
    def from_env(cls) -> LocalE2EConfig | None:
        """Build config from the environment; ``None`` when a required var is missing.

        Returns ``None`` instead of raising so collection never explodes on a typo — the
        skip reason from :func:`local_e2e_skip_reason` is what the runner reports.
        """
        values = {name: os.getenv(name) for name in REQUIRED_ENV}
        if not all(values.values()):
            return None
        try:
            customer_id = int(values["CARAMELI_VS_CUSTOMER_ID"] or "")
        except ValueError:
            return None
        return cls(
            carameli_base_url=(values["CARAMELI_BASE_URL"] or "").rstrip("/"),
            carameli_api_key=values["CARAMELI_API_KEY"] or "",
            vs_customer_id=customer_id,
            vs_local_base_url=(values["VS_LOCAL_BASE_URL"] or "").rstrip("/"),
            notify_secret=values["VS_CARAMELI_NOTIFY_SECRET"] or "",
            vs_public_base_url=(os.getenv("VS_PUBLIC_BASE_URL") or "").rstrip("/") or None,
            vs_webhook_secret=os.getenv("VS_WEBHOOK_SECRET") or None,
            es_url=(os.getenv("ES_URL") or "http://localhost:9200").rstrip("/"),
            es_index=os.getenv("ES_INDEX") or "vanillasoft_dev.events",
        )


def local_e2e_skip_reason() -> str | None:
    """Human-readable reason the suite cannot run, or ``None`` when it can.

    Unlike ``tests/live_e2e``, the gate is not about money — this suite is free. It is
    about *infrastructure*: a remote Carameli and a running local IIS must both exist,
    and neither is present in CI.
    """
    if os.getenv("RUN_LOCAL_E2E") != "1":
        return "Set RUN_LOCAL_E2E=1 to run the local integration suite"
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        return "Local E2E requires env vars: " + ", ".join(missing)
    if LocalE2EConfig.from_env() is None:
        return "CARAMELI_VS_CUSTOMER_ID must be an integer"
    return None


# --------------------------------------------------------------------------------------
# signing — independent reimplementation, see the module docstring
# --------------------------------------------------------------------------------------


def canonical_body(payload: dict[str, Any]) -> bytes:
    """Serialize *payload* exactly the way ``post_notification`` does before signing.

    ``json.dumps(..., separators=(",", ":"))`` and posting those same bytes is what makes
    the MAC reproducible on the receiver. Re-serializing an equal dict with different
    separators produces a signature VanillaSoft cannot verify, which is the single
    easiest way to break this integration — so the bytes are built once, here.
    """
    return json.dumps(payload, separators=(",", ":")).encode()


def sign_payload(body: bytes, timestamp: int, secret: str) -> str:
    """Build the ``X-Carameli-Signature`` value: ``t=<unix>,v1=<hex hmac>``.

    The MAC covers ``"<t>." + body``, so the timestamp is inside the signature and a
    captured request cannot be replayed under a fresh one.
    """
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def signed_headers(body: bytes, secret: str, timestamp: int | None = None) -> dict[str, str]:
    """Full header set for a notify POST, including the ngrok opt-out."""
    return {
        "Content-Type": "application/json",
        SIGNATURE_HEADER: sign_payload(
            body, int(time.time()) if timestamp is None else timestamp, secret
        ),
        **NGROK_SKIP_HEADER,
    }


# --------------------------------------------------------------------------------------
# notify payload builders — the shapes Carameli actually sends
# --------------------------------------------------------------------------------------
#
# These mirror app/services/vanillasoft_notify.py but take primitives instead of ORM
# models, because no database or model layer is available on this machine. Keys and
# casing must match the C# binding targets (IncomingCall.cs, SmsMessage.cs,
# CallRecording.cs) — a renamed key binds to null and the receiver answers 400.

# First block of every call id this suite generates. `callIdUuid` reaches SQL Server as a
# `uniqueidentifier`, so the id must be a *real* GUID — a readable prefix like "LOCALE2E-"
# fails conversion before the insert is even attempted. These eight characters are all
# valid hex and read as "localE2E", which keeps the rows greppable without breaking the
# cast. Cleanup: DELETE FROM dbo.tblCMVCallNotification WHERE UUID LIKE '10CA1E2E-%'.
SYNTHETIC_GUID_PREFIX = "10ca1e2e"


def synthetic_call_id() -> str:
    """A valid GUID, tagged so rows created by this suite are identifiable."""
    return f"{SYNTHETIC_GUID_PREFIX}-{str(uuid.uuid4())[9:]}"


def incoming_call_payload(
    *,
    call_sid: str,
    vs_customer_id: int,
    from_number: str,
    to_number: str,
    event_name: str = "callHungup",
    is_inbound: bool = True,
    timestamp: int | None = None,
) -> dict[str, Any]:
    """Build the ``IncomingCall.cs`` shape for ``POST carameli/notify/IncomingCall``."""
    return {
        "callId": call_sid,
        "callIdUuid": call_sid,
        "timestamp": int(time.time()) if timestamp is None else timestamp,
        "from": from_number,
        "fromName": "",
        "fromNumber": from_number,
        "to": to_number,
        "toNumber": to_number,
        "accountId": str(vs_customer_id),
        "eventName": event_name,
        "isInbound": is_inbound,
        "customerId": vs_customer_id,
    }


def sms_message_payload(
    *,
    message_sid: str,
    vs_customer_id: int,
    from_number: str,
    to_number: str,
    body: str,
    is_outbound: bool = False,
    status: str = "",
) -> dict[str, Any]:
    """Build the ``SmsMessage.cs`` shape for the two SMS notify routes.

    ``customerId`` is a *string* here and an *int* on IncomingCall — that asymmetry is in
    the legacy contract, not a mistake; keep it.
    """
    return {
        "referenceId": message_sid,
        "isOutbound": is_outbound,
        "smsProviderName": "Carameli",
        "accountID": str(vs_customer_id),
        "from": from_number,
        "to": [to_number],
        "timestamp": _now_iso(),
        "message": body,
        "mediaUrls": [],
        "status": status,
        "customerId": str(vs_customer_id),
    }


def call_recording_payload(
    *,
    call_sid: str,
    vs_customer_id: int,
    from_number: str,
    to_number: str,
    recording_url: str,
    length_seconds: int = 12,
) -> dict[str, Any]:
    """Build the ``CallRecording.cs`` shape for ``POST carameli/notify/CallRecording``."""
    now = _now_iso()
    return {
        "accountId": str(vs_customer_id),
        "endpoint": "",
        "recordDate": now,
        "endRecording": now,
        "callerName": "",
        "callerNumber": from_number,
        "recordingFile": recording_url,
        "isInbound": True,
        "length": length_seconds,
        # "carameli", never "asterisk" — the legacy controller drops asterisk recordings.
        "source": "carameli",
        "callId": call_sid,
        "calleeNumber": to_number,
        "CustomerID": vs_customer_id,
        "callIdParent": call_sid,
    }


def _now_iso() -> str:
    """Naive-UTC ISO timestamp, matching ``_isoformat`` on the Carameli side."""
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


def nlog_longdate() -> str:
    """Render ``now`` the way NLog's ``${longdate}`` layout does.

    ``yyyy-MM-dd HH:mm:ss.ffff`` — space-separated, four fractional digits, local time.
    Not ISO-8601, and that is the point: ``VsLogEntry.time`` is a plain ``str`` fed
    straight from the layout, so a test that invents an ISO timestamp would still pass
    while proving nothing about the shape NLog actually posts.
    """
    return f"{time.strftime('%Y-%m-%d %H:%M:%S')}.{int(time.time() % 1 * 10000):04d}"


def nlog_record(
    *,
    message: str,
    level: str = "INFO",
    logger: str = "Carameli.LocalE2E",
    machine: str = "local-e2e",
    exception: str | None = None,
) -> dict[str, Any]:
    """Build the JSON object NLog's ``WebService`` target posts to ``/webhooks/vs-log``.

    Every ``<parameter>`` in the shipped snippet
    (``docs/plans/active/airtight-vanillasoft/nlog-snippet.md``) is present, because
    ``app/schemas/vs_log.py::VsLogEntry`` requires ``time``/``level``/``logger``/
    ``message`` and a payload missing any of them is a 422 that says nothing about the
    channel. ``auth`` is deliberately absent: the suite authenticates with the
    ``X-Cloudli-Auth`` header, which is what an NLog build new enough for ``<header>``
    does, and the body fallback is a separate concern.
    """
    return {
        "time": nlog_longdate(),
        "level": level,
        "logger": logger,
        "message": message,
        "exception": exception,
        "machine": machine,
    }


# --------------------------------------------------------------------------------------
# HTTP wrappers
# --------------------------------------------------------------------------------------


class CarameliApi:
    """Thin authed client for the *remote* Carameli, mirroring ``CarameliClient.cs``.

    The .NET client reads ``CarameliApiBaseUrl`` (which points at ``/vsapi/1.0.0/``) and
    derives the native ``/api/v1`` tree from the same origin. This wrapper takes the
    origin and builds both, so a test failure names the route rather than a URL the
    reader has to reassemble.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {api_key}", **NGROK_SKIP_HEADER},
        )

    def vsapi_url(self, path: str) -> str:
        return f"{self._base_url}{VSAPI_PREFIX}/{path.lstrip('/')}"

    def native_url(self, path: str) -> str:
        return f"{self._base_url}{NATIVE_PREFIX}/{path.lstrip('/')}"

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._client.get(url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._client.post(url, **kwargs)

    async def aclose(self) -> None:
        await self._client.aclose()


async def post_notify(
    base_url: str,
    path: str,
    payload: dict[str, Any],
    secret: str,
    *,
    timestamp: int | None = None,
    signature_override: str | None = None,
) -> httpx.Response:
    """POST a signed notify to a VanillaSoft VoipApi base, exactly as Carameli does.

    *base_url* is the VoipApi application root (local or tunnelled);
    ``carameli/notify/`` and *path* are appended. ``signature_override`` replaces the
    computed header so negative tests can send a wrong or malformed signature over an
    otherwise-valid request.
    """
    body = canonical_body(payload)
    headers = signed_headers(body, secret, timestamp)
    if signature_override is not None:
        headers[SIGNATURE_HEADER] = signature_override
    url = f"{base_url.rstrip('/')}/{NOTIFY_PREFIX}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=45.0) as client:
        # `content=`, never `json=` — httpx would re-serialize and invalidate the MAC.
        return await client.post(url, content=body, headers=headers)


def assert_json(response: httpx.Response, context: str) -> Any:
    """Return the parsed JSON body, failing with a legible message when it is not JSON.

    Guards the ngrok interstitial specifically: it arrives as HTML with status 200, so a
    status-only assertion would pass while the request never reached Carameli at all.
    """
    content_type = response.headers.get("content-type", "")
    if "json" not in content_type.lower():
        snippet = response.text[:300].replace("\n", " ")
        hint = ""
        if "ngrok" in snippet.lower() or "<!doctype html" in snippet.lower():
            hint = (
                " — this looks like ngrok's browser interstitial, which returns HTTP 200 "
                "for HTML. Send the 'ngrok-skip-browser-warning' header."
            )
        raise AssertionError(
            f"{context}: expected JSON, got content-type={content_type!r} "
            f"status={response.status_code} body={snippet!r}{hint}"
        )
    return response.json()


def describe(response: httpx.Response) -> str:
    """One-line response summary for assertion messages.

    The honest receiver puts its real failure reason in the body, so an assertion that
    prints only the status code throws away the thing you actually need.
    """
    return f"status={response.status_code} body={response.text[:600]!r}"


# --------------------------------------------------------------------------------------
# Elasticsearch — the local log channel
# --------------------------------------------------------------------------------------


async def es_search(es_url: str, index: str, query: dict[str, Any]) -> dict[str, Any]:
    """Run a search against the local Elasticsearch that NLog ships VanillaSoft logs to."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(f"{es_url}/{index}/_search", json=query)
        response.raise_for_status()
        return response.json()


def hits_of(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract ``_source`` documents from an Elasticsearch search result."""
    return [hit.get("_source", {}) for hit in result.get("hits", {}).get("hits", [])]


# --------------------------------------------------------------------------------------
# polling
# --------------------------------------------------------------------------------------


async def poll_until(
    predicate: Callable[[], Awaitable[Any]],
    *,
    timeout_s: float = 60.0,
    interval_s: float = 3.0,
    description: str = "condition",
) -> Any:
    """Await *predicate* until it returns something truthy, then return it.

    Raises ``TimeoutError`` naming the last observed value. That message is the whole
    point: it is what a human or a coding agent debugs from, so it must say what was
    seen, not merely that time ran out.
    """
    deadline = time.monotonic() + timeout_s
    last: Any = None
    while True:
        last = await predicate()
        if last:
            return last
        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Timed out after {timeout_s:.0f}s waiting for {description}; last value: {last!r}"
            )
        await asyncio.sleep(interval_s)
