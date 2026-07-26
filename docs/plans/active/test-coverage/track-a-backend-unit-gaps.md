# Track A — Backend Unit Gaps

Five sequential sessions. Each session extends or creates test files in `tests/unit/`.
No external dependencies — everything runs with the standard Docker stack (Postgres + Redis).

---

## Conventions (read before writing a single line of test code)

- Every test file must start with: `pytestmark = pytest.mark.asyncio(loop_scope="session")`
- All async tests must be `async def`.
- Use the `client` fixture for HTTP calls, `db_session` for direct ORM access.
- Mock **only** at `app.state.carrier`, `app.state.engine`, and Redis. Never mock repos, services, or SQLAlchemy internals.
- Use `AsyncMock` for async provider methods, `MagicMock` for sync.
- `AUTH_HEADERS` is imported from `tests.conftest` — it is `{"Authorization": "Bearer <API_KEY>"}`.
- No teardown cleanup — the `db_session` savepoint rollback handles isolation.
- Inline factory helpers per file (e.g., `async def _create_customer(client, vs_id)`). No shared utils module.
- One test file per source module, named `test_<module>.py`.

---

## Session A1 — Missing module coverage (seven new test areas)

**Goal:** Fill the seven coverage gaps identified in §2.M of the checklist. Some gaps require
new files; others require extending existing files. Read the existing file before touching it.

### 1. `tests/unit/test_call_sync.py` — extend with retry logic cases

Read the file first. It probably covers the ARQ worker settings and basic scheduling. Add the following test cases for `retry_unposted_events` in `app/services/call_sync.py`:

```python
from unittest.mock import AsyncMock, patch, MagicMock
import pytest
from app.services.call_sync import retry_unposted_events, _vanillasoft_headers

# _vanillasoft_headers
async def test_vanillasoft_headers_no_secret_returns_empty():
    # Temporarily clear settings.vanillasoft_webhook_secret, call _vanillasoft_headers(),
    # assert result == {}

async def test_vanillasoft_headers_with_secret_returns_bearer():
    # Set settings.vanillasoft_webhook_secret = "mysecret"  # pragma: allowlist secret
    # assert _vanillasoft_headers() == {"Authorization": "Bearer mysecret"}

# retry_unposted_events — no webhook URL configured
async def test_retry_no_webhook_url_returns_early(db_session):
    # patch settings.vanillasoft_webhook_url = None
    # Call retry_unposted_events({})
    # Assert no HTTP calls made (patch httpx.AsyncClient to verify)

# retry_unposted_events — no unposted events
async def test_retry_no_events_returns_early(db_session):
    # settings.vanillasoft_webhook_url = "http://vs.test"
    # No call events in DB
    # Call retry_unposted_events({}) — must not raise, no HTTP calls

# retry_unposted_events — VanillaSoft 200 → marks event as posted
async def test_retry_success_marks_event_posted(client, db_session):
    # Create a customer and a call event (status="completed", posted=False, older than 1 min)
    # patch httpx.AsyncClient.post to return a mock Response with is_success=True
    # Call retry_unposted_events({})
    # Assert event.posted_at is not None (re-query from db_session)

# retry_unposted_events — VanillaSoft 500 → event stays unposted
async def test_retry_vs_500_event_stays_unposted(client, db_session):
    # Same setup as above but mock response is_success=False, status_code=500
    # Assert event.posted_at is still None

# retry_unposted_events — non-terminal status is skipped
async def test_retry_skips_non_terminal_status(client, db_session):
    # Create call event with status="ringing"
    # Patch httpx — assert no HTTP calls made
```

**How to create a call event directly in tests:**
Use `CallEventRepo(db_session).create(...)` or insert via SQLAlchemy. Look at how
`test_webhooks.py` creates events via the webhook endpoint, which is the cleanest approach.

### 2. `tests/unit/test_agent_status.py` — extend with poller cases

Read the existing file. Add:

```python
from app.services.agent_status_sync import _map_call_status, poll_agent_status, startup, shutdown

# _map_call_status
@pytest.mark.parametrize("raw,expected", [
    ("trying", "ringing"),
    ("ringing", "ringing"),
    ("early", "ringing"),
    ("in-progress", "on-call"),
    ("completed", "idle"),
    ("failed", "idle"),
    ("TRYING", "ringing"),       # case-insensitive
    ("unknown-state", "unknown-state"),  # passthrough
])
def test_map_call_status(raw, expected):
    assert _map_call_status(raw) == expected

# poll_agent_status — no engine in ctx
async def test_poll_no_engine_logs_error_and_returns():
    # await poll_agent_status({})  — must not raise

# poll_agent_status — engine.get_active_calls raises
async def test_poll_engine_exception_returns_without_crash():
    mock_engine = MagicMock()
    mock_engine.get_active_calls = AsyncMock(side_effect=RuntimeError("boom"))
    await poll_agent_status({"engine": mock_engine})  # must not raise

# poll_agent_status — happy path (no active calls, one registered extension)
async def test_poll_happy_path_upserts_idle_row(client, db_session):
    # Create customer + extension (sip_username="user1")
    # mock engine: get_active_calls=[] get_registrations=[{"sipUser": "user1"}]
    # await poll_agent_status({"engine": mock_engine})
    # Query AgentStatusRepo — assert row exists with sip_registered=True, call_state="idle"

# startup / shutdown
async def test_startup_stores_engine_on_ctx():
    ctx = {}
    await startup(ctx)
    assert "engine" in ctx

async def test_shutdown_calls_aclose():
    mock_engine = MagicMock()
    mock_engine.aclose = AsyncMock()
    await shutdown({"engine": mock_engine})
    mock_engine.aclose.assert_awaited_once()

async def test_shutdown_no_engine_does_not_raise():
    await shutdown({})  # must not raise
```

### 3. New file: `tests/unit/test_factory.py`

```python
from __future__ import annotations
import pytest
from unittest.mock import patch
pytestmark = pytest.mark.asyncio(loop_scope="session")

def test_get_carrier_provider_telnyx():
    from app.services.providers.factory import get_carrier_provider
    from app.services.providers.carrier.telnyx import TelnyxCarrier
    provider = get_carrier_provider()
    assert isinstance(provider, TelnyxCarrier)

def test_get_carrier_provider_unknown_raises():
    from app.services.providers.factory import get_carrier_provider
    from app.core.config import settings
    original = settings.carrier_provider
    settings.carrier_provider = "nonexistent"
    with pytest.raises(ValueError, match="nonexistent"):
        get_carrier_provider()
    settings.carrier_provider = original

def test_get_call_engine_provider_jambonz():
    from app.services.providers.factory import get_call_engine_provider
    from app.services.providers.engine.jambonz import JambonzEngine
    provider = get_call_engine_provider()
    assert isinstance(provider, JambonzEngine)

def test_get_call_engine_provider_unknown_raises():
    from app.services.providers.factory import get_call_engine_provider
    from app.core.config import settings
    original = settings.call_engine_provider
    settings.call_engine_provider = "nonexistent"
    with pytest.raises(ValueError, match="nonexistent"):
        get_call_engine_provider()
    settings.call_engine_provider = original
```

### 4. New file: `tests/unit/test_frontend_logs.py`

Endpoint: `POST /vg/1.0.0/frontend-logs` — returns 204, requires auth.

```python
from __future__ import annotations
import pytest
from tests.conftest import AUTH_HEADERS
pytestmark = pytest.mark.asyncio(loop_scope="session")

_URL = "/vg/1.0.0/frontend-logs"

async def test_ingest_logs_returns_204(client):
    resp = await client.post(
        _URL,
        json={"entries": [{"level": "info", "message": "hello"}]},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 204

async def test_ingest_logs_requires_auth(client):
    resp = await client.post(
        _URL,
        json={"entries": [{"level": "info", "message": "hello"}]},
    )
    assert resp.status_code == 401

async def test_ingest_empty_batch(client):
    resp = await client.post(_URL, json={"entries": []}, headers=AUTH_HEADERS)
    assert resp.status_code == 204

@pytest.mark.parametrize("level", ["debug", "info", "warn", "warning", "error", "UNKNOWN"])
async def test_ingest_all_levels(client, level):
    resp = await client.post(
        _URL,
        json={"entries": [{"level": level, "message": "msg"}]},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 204

async def test_ingest_with_context(client):
    resp = await client.post(
        _URL,
        json={"entries": [{"level": "error", "message": "bad", "context": {"status": 502}}]},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 204
```

### 5. New file: `tests/unit/test_config.py`

Tests for `parse_cors_origins` validator in `app/core/config.py`.
Do **not** mutate the global `settings` object — instantiate a fresh `Settings()` with `_env_file=None`.

```python
from __future__ import annotations
import pytest
from app.core.config import Settings
pytestmark = pytest.mark.asyncio(loop_scope="session")

def _make(cors_origins_str: str) -> list[str]:
    s = Settings.model_construct()
    return Settings.parse_cors_origins(cors_origins_str)

def test_comma_separated():
    result = Settings.parse_cors_origins("http://a.com, http://b.com")
    assert result == ["http://a.com", "http://b.com"]

def test_json_array_string():
    result = Settings.parse_cors_origins('["http://a.com","http://b.com"]')
    assert result == ["http://a.com", "http://b.com"]

def test_empty_string_returns_empty_list():
    assert Settings.parse_cors_origins("") == []

def test_whitespace_only_items_stripped():
    result = Settings.parse_cors_origins("http://a.com,  ,http://b.com")
    assert result == ["http://a.com", "http://b.com"]

def test_list_passthrough():
    result = Settings.parse_cors_origins(["http://a.com", " http://b.com "])
    assert result == ["http://a.com", "http://b.com"]
```

For the wildcard `*` fallback test, it lives in `app/main.py` startup. Test it by checking the
app middleware does not contain `"*"` in its CORS origins when `settings.cors_origins = ["*"]`
at startup — this can be validated by inspecting the `CORSMiddleware` state on the app.
Add that test to `test_config.py` as `test_wildcard_cors_falls_back_to_localhost`.

### 6. Exception handler tests — extend `tests/unit/test_health.py`

Read `test_health.py`. Add:

```python
from sqlalchemy.exc import DataError

async def test_data_error_returns_422(client):
    # Trigger a DataError by sending a string where an integer is required
    # Pick any endpoint that has an integer path param (e.g. GET /vsapi/1.0.0/VsCustomer/Get/not-an-int)
    # The DataError handler in main.py should convert this to 422
    resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/not-an-int", headers=AUTH_HEADERS)
    assert resp.status_code in (404, 422)  # 422 if DataError path triggers, 404 if FastAPI rejects first

async def test_unhandled_exception_returns_500_without_leaking_details(client):
    # Patch a service to raise RuntimeError, verify the response body has no traceback
    from unittest.mock import patch, AsyncMock
    from app.services import customer_service
    with patch.object(customer_service, "get_by_id", AsyncMock(side_effect=RuntimeError("secret"))):
        resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/999", headers=AUTH_HEADERS)
    assert resp.status_code == 500
    assert "secret" not in resp.text
    assert "Traceback" not in resp.text
```

### 7. Prometheus metrics endpoint — extend `tests/unit/test_health.py`

```python
async def test_metrics_endpoint_returns_prometheus_text(client):
    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    # Prometheus format always starts with a # HELP or # TYPE comment
    assert resp.text.startswith("#") or "http_requests" in resp.text
```

---

## Session A2 — Adversarial webhook security tests

**Goal:** Cover every security rejection path for both webhook handlers.
Extend `tests/unit/test_webhooks.py`. Add a clearly labelled section with a comment
`# ── Security / adversarial tests ──────────────────────────────────────────`.

### Jambonz HMAC signature tests

The signature function is `_validate_jambonz_signature` in `app/api/webhooks/call_status.py`.
The secret is `settings.jambonz_webhook_secret`. When it is empty the check is skipped (dev mode).

Add a shared helper at the top of the security section:

```python
import hashlib
import hmac as _stdlib_hmac

def _jambonz_sig(body: bytes, secret: str) -> str:
    return _stdlib_hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
```

Tests:

```python
# 1. Valid signature accepted
async def test_jambonz_valid_signature_accepted(client):
    secret = "test-secret"  # pragma: allowlist secret
    body = b'{"call_sid":"CAsigok","call_status":"completed"}'
    sig = _jambonz_sig(body, secret)
    orig = settings.jambonz_webhook_secret
    settings.jambonz_webhook_secret = secret
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": sig},
    )
    settings.jambonz_webhook_secret = orig
    assert resp.status_code == 200

# 2. Invalid signature rejected (already partially covered — make explicit)
async def test_jambonz_invalid_signature_returns_403(client):
    settings.jambonz_webhook_secret = "real-secret"  # pragma: allowlist secret
    body = b'{"call_sid":"CAbadsig","call_status":"completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": "bad"},
    )
    settings.jambonz_webhook_secret = ""
    assert resp.status_code == 403

# 3. Tampered payload: sign the original, modify the body
async def test_jambonz_tampered_payload_returns_403(client):
    secret = "tamper-secret"  # pragma: allowlist secret
    original = b'{"call_sid":"CAtamper","call_status":"completed"}'
    sig = _jambonz_sig(original, secret)
    tampered = b'{"call_sid":"CAtamper","call_status":"failed"}'
    settings.jambonz_webhook_secret = secret
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=tampered,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": sig},
    )
    settings.jambonz_webhook_secret = ""
    assert resp.status_code == 403

# 4. Empty signature header with secret configured
async def test_jambonz_empty_signature_returns_403(client):
    settings.jambonz_webhook_secret = "nonempty"  # pragma: allowlist secret
    body = b'{"call_sid":"CAemptysig","call_status":"completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": ""},
    )
    settings.jambonz_webhook_secret = ""
    assert resp.status_code == 403

# 5. No secret configured → signature not validated (dev mode)
async def test_jambonz_no_secret_configured_skips_validation(client):
    settings.jambonz_webhook_secret = ""
    body = b'{"call_sid":"CAnosecret","call_status":"completed"}'
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
```

### Telnyx Ed25519 signature tests

The validation function is `_validate_telnyx_signature` in `app/api/webhooks/sms_inbound.py`.
It verifies an Ed25519 signature. `TELNYX_WEBHOOK_SECRET` is a **base64-encoded Ed25519 public key**.

Add a helper that generates a temporary Ed25519 key pair for testing:

```python
import base64
import time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def _make_telnyx_keypair():
    priv = Ed25519PrivateKey.generate()
    pub_bytes = priv.public_key().public_bytes_raw()
    pub_b64 = base64.b64encode(pub_bytes).decode()
    return priv, pub_b64

def _telnyx_sign(priv: Ed25519PrivateKey, body: bytes, ts: str) -> str:
    signed_payload = f"{ts}|".encode() + body
    return base64.b64encode(priv.sign(signed_payload)).decode()
```

Tests:

```python
# 1. Valid Ed25519 signature accepted
async def test_telnyx_valid_signature_accepted(client):
    priv, pub_b64 = _make_telnyx_keypair()
    body = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()))
    sig = _telnyx_sign(priv, body, ts)
    settings.telnyx_webhook_secret = pub_b64
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={"Content-Type": "application/json",
                 "telnyx-signature-ed25519": sig,
                 "telnyx-timestamp": ts},
    )
    settings.telnyx_webhook_secret = ""
    assert resp.status_code == 204

# 2. Invalid signature rejected
async def test_telnyx_invalid_signature_returns_403(client):
    _, pub_b64 = _make_telnyx_keypair()
    body = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()))
    settings.telnyx_webhook_secret = pub_b64
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={"Content-Type": "application/json",
                 "telnyx-signature-ed25519": base64.b64encode(b"badsig").decode(),
                 "telnyx-timestamp": ts},
    )
    settings.telnyx_webhook_secret = ""
    assert resp.status_code == 403

# 3. Stale timestamp (> 300 s old) rejected
async def test_telnyx_stale_timestamp_returns_403(client):
    priv, pub_b64 = _make_telnyx_keypair()
    body = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()) - 400)  # 400 s ago
    sig = _telnyx_sign(priv, body, ts)
    settings.telnyx_webhook_secret = pub_b64
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=body,
        headers={"Content-Type": "application/json",
                 "telnyx-signature-ed25519": sig,
                 "telnyx-timestamp": ts},
    )
    settings.telnyx_webhook_secret = ""
    assert resp.status_code == 403

# 4. Missing timestamp header
async def test_telnyx_missing_timestamp_returns_403(client):
    _, pub_b64 = _make_telnyx_keypair()
    settings.telnyx_webhook_secret = pub_b64
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        json={"data": {"event_type": "message.received", "payload": {}}},
        headers={"telnyx-signature-ed25519": "whatever"},
    )
    settings.telnyx_webhook_secret = ""
    assert resp.status_code == 403

# 5. Tampered payload with valid signature for original body
async def test_telnyx_tampered_payload_returns_403(client):
    priv, pub_b64 = _make_telnyx_keypair()
    original = b'{"data":{"event_type":"message.received","payload":{}}}'
    ts = str(int(time.time()))
    sig = _telnyx_sign(priv, original, ts)
    tampered = b'{"data":{"event_type":"message.received","payload":{"injected":true}}}'
    settings.telnyx_webhook_secret = pub_b64
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        content=tampered,
        headers={"Content-Type": "application/json",
                 "telnyx-signature-ed25519": sig,
                 "telnyx-timestamp": ts},
    )
    settings.telnyx_webhook_secret = ""
    assert resp.status_code == 403

# 6. No secret configured → signature check skipped
async def test_telnyx_no_secret_configured_skips_validation(client):
    settings.telnyx_webhook_secret = ""
    resp = await client.post(
        "/webhooks/telnyx/sms-inbound",
        json={"data": {"event_type": "message.received", "payload": {}}},
    )
    assert resp.status_code == 204
```

**Important:** Always restore `settings.telnyx_webhook_secret` and `settings.jambonz_webhook_secret`
after each test. Prefer wrapping with `try/finally` or using a fixture that snapshots and restores settings.

---

## Session A3 — Security + multi-tenant isolation + session lifecycle

### New file: `tests/unit/test_session.py`

Tests for `app/core/session.py` — `sign_token` / `verify_signed_token`:

```python
from app.core.session import sign_token, verify_signed_token, COOKIE_NAME

def test_sign_and_verify_roundtrip():
    signed = sign_token("my-token")
    assert verify_signed_token(signed) == "my-token"

def test_tampered_signature_returns_none():
    signed = sign_token("my-token")
    tampered = signed[:-3] + "xxx"
    assert verify_signed_token(tampered) is None

def test_missing_dot_returns_none():
    assert verify_signed_token("nodot") is None

def test_empty_string_returns_none():
    assert verify_signed_token("") is None
```

### Extend `tests/unit/test_auth.py` — session endpoint lifecycle

Read `test_auth.py` first. Add:

```python
# POST /auth/session → sets cookie
async def test_create_session_sets_cookie(client):
    resp = await client.post("/auth/session")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert "carameli_session" in resp.cookies

# DELETE /auth/session → clears cookie
async def test_destroy_session_clears_cookie(client):
    await client.post("/auth/session")  # set it first
    resp = await client.delete("/auth/session")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

# GET /auth/me with valid Bearer token → returns auth context
async def test_me_with_bearer_returns_context(client):
    resp = await client.get("/auth/me", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["authenticated"] is True
    assert data["is_admin"] is True

# GET /auth/me with valid session cookie → returns auth context
async def test_me_with_session_cookie_returns_context(client):
    await client.post("/auth/session")
    resp = await client.get("/auth/me")  # cookie is auto-sent by httpx
    assert resp.status_code == 200

# GET /auth/me with no credentials → 401
async def test_me_unauthenticated_returns_401(client):
    resp = await client.get("/auth/me")
    assert resp.status_code == 401

# GET /auth/me with wrong API key → 401
async def test_me_wrong_api_key_returns_401(client):
    resp = await client.get("/auth/me", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401

# GET /auth/me with tampered cookie → 401
async def test_me_tampered_cookie_returns_401(client):
    resp = await client.get("/auth/me", cookies={"carameli_session": "bad.signature"})
    assert resp.status_code == 401
```

### Multi-tenant isolation tests — new file: `tests/unit/test_customer_isolation.py`

For each resource type, verify that a customer-scoped API key cannot read or mutate another
customer's resources.

Pattern: create two customers (admin auth), create a resource for customer A, authenticate as
customer B using their own API key, assert 403.

```python
async def _create_customer_with_key(client, vs_id: int, api_key: str) -> dict:
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": vs_id, "api_key": api_key},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    return resp.json()

# Phone line: customer B cannot read customer A's phone lines
async def test_phoneline_cross_customer_denied(client):
    await _create_customer_with_key(client, 9001, "key-9001")
    await _create_customer_with_key(client, 9002, "key-9002")
    from app.main import app
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+19001550000"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNiso001", "phone_number": "+19001550000"}
    )
    await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 9001, "area_code": "900"},
        headers=AUTH_HEADERS,
    )
    # Authenticate as customer B (vs_id=9002) and try to access customer A's resources
    resp = await client.get(
        "/vsapi/1.0.0/PhoneLine/GetCount/9001",
        headers={"Authorization": "Bearer key-9002"},
    )
    assert resp.status_code == 403

# Repeat the same pattern for extensions and SMS
# (one test per resource type is sufficient for isolation confidence)
```

---

## Session A4 — Migration + schema safety tests

Read `tests/unit/test_migration_concerns.py` in full before adding anything.

The goal is to add or confirm these cases exist:

1. **Upgrade on clean DB** — run all migrations from scratch against an empty schema.
   Use `alembic upgrade head` in a subprocess or call alembic's Python API directly.
   Assert the final DB state matches `Base.metadata` (no unexpected tables/columns).

2. **Downgrade path** — for each migration, verify it has a non-empty `downgrade()` body.
   Use `alembic history` output or parse the migration files directly.
   A downgrade that only contains `pass` is a failing test.

3. **Round-trip** — `alembic upgrade head` → `alembic downgrade base` → `alembic upgrade head`.
   Assert no errors and the final schema matches expectations.

4. **Schema drift detection** — after running all migrations, compare `Base.metadata.tables`
   against the live DB's `information_schema.tables` and column lists.
   Any column in the ORM model that is missing from the DB (or vice versa) is a failing test.

Use `subprocess.run(["alembic", ...], cwd=project_root, check=True)` for Alembic CLI calls.
Run these tests against a **separate test schema** (not the `public` schema used by other tests)
to avoid interference. Use `CREATE SCHEMA migration_test` + `SET search_path = migration_test`.

**Important:** These tests are slow (~5–15 s each). Mark them with `@pytest.mark.slow` and
add `slow` to the `addopts` exclusion list in `pytest.ini` so they do not block the fast suite.
Run them explicitly: `pytest -m slow`.

---

## Session A5 — Concurrency + idempotency tests

### New file: `tests/unit/test_concurrency.py`

Use `asyncio.gather` to fire concurrent requests from the same `client` fixture.

```python
import asyncio
from unittest.mock import AsyncMock
from tests.conftest import AUTH_HEADERS

# 1. Duplicate webhook: same call_sid delivered twice concurrently → exactly one DB row
async def test_concurrent_duplicate_webhook_creates_one_row(client, db_session):
    payload = {"call_sid": "CAconc001", "call_status": "completed",
               "from": "+14155550000", "to": "+14155550001"}
    results = await asyncio.gather(
        client.post("/webhooks/jambonz/call-status", json=payload),
        client.post("/webhooks/jambonz/call-status", json=payload),
    )
    assert all(r.status_code == 200 for r in results)
    from sqlalchemy import select
    from app.models.call_event import CallEvent
    rows = (await db_session.execute(
        select(CallEvent).where(CallEvent.call_sid == "CAconc001")
    )).scalars().all()
    assert len(rows) == 1

# 2. Concurrent phone line add: two simultaneous requests for different area codes
# for the same customer → both succeed, two distinct phone line rows
async def test_concurrent_phone_line_add(client, db_session):
    from app.main import app
    # Create customer first (serial)
    await client.post("/vsapi/1.0.0/VsCustomer/Create",
                      json={"vs_customer_id": 8001, "api_key": "key-8001"},
                      headers=AUTH_HEADERS)
    app.state.carrier.search_numbers = AsyncMock(side_effect=[
        [{"phone_number": "+18001550001"}],
        [{"phone_number": "+18001550002"}],
    ])
    app.state.carrier.provision_number = AsyncMock(side_effect=[
        {"sid": "PNconc001", "phone_number": "+18001550001"},
        {"sid": "PNconc002", "phone_number": "+18001550002"},
    ])
    results = await asyncio.gather(
        client.post("/vsapi/1.0.0/PhoneLine/Add",
                    json={"vs_customer_id": 8001, "area_code": "800"}, headers=AUTH_HEADERS),
        client.post("/vsapi/1.0.0/PhoneLine/Add",
                    json={"vs_customer_id": 8001, "area_code": "800"}, headers=AUTH_HEADERS),
    )
    assert all(r.status_code == 201 for r in results)
    numbers = {r.json()["phone_number"] for r in results}
    assert len(numbers) == 2  # distinct numbers, no collision

# 3. Concurrent customer creation with same vs_customer_id → only one succeeds (409 or unique constraint)
async def test_concurrent_duplicate_customer_create(client):
    results = await asyncio.gather(
        client.post("/vsapi/1.0.0/VsCustomer/Create",
                    json={"vs_customer_id": 8002, "api_key": "key-8002a"}, headers=AUTH_HEADERS),
        client.post("/vsapi/1.0.0/VsCustomer/Create",
                    json={"vs_customer_id": 8002, "api_key": "key-8002b"}, headers=AUTH_HEADERS),
    )
    status_codes = {r.status_code for r in results}
    assert 201 in status_codes
    assert status_codes <= {201, 409}  # one created, one conflict — no 500s
```

---

## Verification

After each session, run:

```bash
docker compose exec app pytest tests/unit/ -x -q
```

All tests must be green before moving to the next session. Do not leave skipped or xfail tests
without a comment explaining why.
