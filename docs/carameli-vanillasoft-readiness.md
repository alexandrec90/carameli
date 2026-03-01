# Carameli: VanillaSoft Readiness Plan

**Target audience:** AI coding agent working on this Carameli (VoiceGateway) repository.

This document lists every gap that must be closed before VanillaSoft can rely on Carameli
in production. Work through the sections in order — earlier items unblock later ones.

---

## Status Snapshot

| Area | State |
|---|---|
| Customer CRUD + auth | ✅ Done |
| DID provisioning | ✅ Done |
| SMS send/enable/disable | ✅ Done |
| Outbound calling / voicemail drop | ✅ Done |
| Extension (SIP) management | ✅ Done |
| SCI rules storage | ✅ Done (DB only) |
| DID → Extension pointers storage | ✅ Done (DB only) |
| Call events write to DB | ✅ Done |
| **Inbound call routing (SCI + pointers → TwiML)** | ❌ Not implemented |
| **CORS for VanillaSoft origin** | ❌ Not configured |
| **Call data write-back to VanillaSoft** | ❌ Not implemented |
| **Recording retrieval endpoint** | ❌ Missing |
| **Per-customer API key auth** | ⚠️ Schema exists, validation not wired to routes |
| **Docker / network exposure** | ⚠️ Needs production config |
| **Test coverage** | ⚠️ Minimal |

---

## Task 1 — Wire inbound call routing (TwiML)

**Why it matters:** Without this, inbound calls to provisioned DIDs produce a generic
"Please hold" message and never reach the agent's SIP extension. SCI rules and pointer
mappings stored in the DB are currently unused.

**File:** `app/api/webhooks/call_status.py` contains a stub `/webhooks/twilio/voice`
handler. Replace it with real routing logic.

### What to implement

When Twilio fires `POST /webhooks/twilio/voice` (form-encoded), the request body
contains at minimum:

```
To      = the DID that was called  (e.g. +14155550100)
From    = caller's number
CallSid = unique Twilio call ID
```

The handler must:

1. **Look up the DID** in `phone_lines` by `phone_number = To`.
2. **Look up pointers** in `did_pointers` for that `phone_line_id` to find the mapped
   `extension_id`.
3. **Look up the extension** in `extensions` to get `sip_username` and
   `twilio_domain_sid`.
4. **Check SCI rules** — if the customer has SCI enabled (`sci_rules.enabled = true`),
   check whether the caller's zip code (requires a zip-code lookup from the caller's
   area code or an external geo API) matches any active `sci_rules` record for that
   extension. If no match, either reject or route to a fallback.
5. **Return TwiML** that dials the SIP extension:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:{sip_username}@{sip_domain}.sip.twilio.com</Sip>
  </Dial>
</Response>
```

### Notes

- Import and use `DidPointerRepo`, `ExtensionRepo`, `SciRuleRepo` from
  `app/repositories/`.
- Use an async DB session via `get_db` dependency.
- Return `Response(content=twiml_str, media_type="application/xml")`.
- If no pointer exists for the DID, return a TwiML `<Say>` or `<Hangup>` rather than
  crashing.
- SCI zip-code matching: for Phase 1 it is acceptable to match on the caller's NPA
  (area code) prefix if a full geo lookup is too complex. Document any simplification.

---

## Task 2 — CORS configuration

**Why it matters:** VanillaSoft's web application makes cross-origin requests to Carameli.
Without the correct CORS headers the browser will block every call.

**File:** `app/main.py`

### What to change

The current `CORSMiddleware` configuration likely allows all origins (`"*"`). Replace it
with an explicit allowlist driven by environment variables:

```python
# app/core/config.py — add:
cors_origins: list[str] = Field(
    default=["http://localhost:3000"],
    description="Comma-separated list of allowed CORS origins",
)

# app/main.py — update:
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```

Add to `.env.example`:

```dotenv
CORS_ORIGINS=https://vanillasoft.example.com,https://app.vanillasoft.com
```

Parse the env var as a comma-separated string in `config.py` using a validator.

---

## Task 3 — Per-customer API key authentication

**Why it matters:** Currently all routes are protected by a single global `API_KEY_SECRET`.
The Carameli data model already stores a per-customer `api_key`, but routes do not
validate it. VanillaSoft will authenticate with the global key (service-to-service), so
the global key is fine for now — but the per-customer key should at least be validated
on the `VsCustomer` routes so the schema is coherent.

### What to implement

This can be deferred to Phase 2 if VanillaSoft always uses the global service key. If
per-customer isolation is needed now:

1. Add an optional dependency `get_customer_from_bearer()` that checks the `api_key`
   column in `customers` instead of `settings.api_key_secret`.
2. Apply it to routes that take `vs_customer_id` so that a caller can only operate on
   their own customer record.
3. The global key bypasses this check (admin operations).

---

## Task 4 — Call data write-back to VanillaSoft

**Why it matters:** VanillaSoft needs to know when calls complete, how long they lasted,
and whether a recording is available. Currently `call_events.posted` is set to `false`
and no write-back happens.

### What to implement

**Step 4a — Add VanillaSoft callback config**

```python
# app/core/config.py — add:
vanillasoft_webhook_url: str | None = Field(
    default=None,
    description="VanillaSoft endpoint to POST completed call events",
)
vanillasoft_webhook_secret: str | None = None
```

`.env.example`:

```dotenv
VANILLASOFT_WEBHOOK_URL=https://vs.example.com/api/voip/call-complete
VANILLASOFT_WEBHOOK_SECRET=shared-secret
```

**Step 4b — Post call data after Twilio callback**

In `app/api/webhooks/call_status.py`, after the call event is written to the DB:

```python
if settings.vanillasoft_webhook_url and call_event.status in ("completed", "no-answer", "busy", "failed"):
    payload = {
        "call_sid":         call_event.twilio_call_sid,
        "vs_customer_id":   customer.vs_customer_id,
        "from":             call_event.from_number,
        "to":               call_event.to_number,
        "extension":        call_event.extension,
        "duration_seconds": call_event.duration_seconds,
        "recording_url":    call_event.recording_url,
        "status":           call_event.status,
        "started_at":       call_event.started_at.isoformat() if call_event.started_at else None,
        "ended_at":         call_event.ended_at.isoformat() if call_event.ended_at else None,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.vanillasoft_webhook_url,
            json=payload,
            headers={"Authorization": f"Bearer {settings.vanillasoft_webhook_secret}"},
            timeout=10.0,
        )
    if resp.is_success:
        await call_event_repo.mark_posted(db, call_event.id)
    # else: APScheduler retry job will re-attempt
```

**Step 4c — Add `mark_posted` to `CallEventRepo`**

```python
# app/repositories/call_event_repo.py
async def mark_posted(self, db, event_id: UUID) -> None:
    await db.execute(
        update(CallEvent)
        .where(CallEvent.id == event_id)
        .values(posted=True, matched_at=datetime.utcnow())
    )
    await db.commit()
```

**Step 4d — Retry in APScheduler job**

The existing `call_sync.py` job runs every 30 s. Extend it to also retry
`posted=False` events older than 1 minute by re-attempting the webhook POST.

---

## Task 5 — Recording retrieval endpoint

**Why it matters:** VanillaSoft may need to surface call recordings in the CRM UI.
Carameli stores the Twilio recording URL but exposes no route to retrieve it.

### What to implement

Add to `app/api/vsapi/phone_lines.py` (or a new `calls.py` router):

```
GET /vsapi/1.0.0/VsCall/Recording/{call_sid}

→ 200  { "call_sid": "CAxxx", "recording_url": "https://api.twilio.com/...", "duration_seconds": 120 }
→ 404  { "detail": "Call not found" }
→ 404  { "detail": "No recording for this call" }
```

Implementation: query `call_events` by `twilio_call_sid`, return `recording_url` and
`duration_seconds`.

---

## Task 6 — Docker / network exposure

**Why it matters:** Carameli must be reachable by both VanillaSoft (HTTP/S) and Twilio
(webhooks). The current `docker-compose.yml` binds the API to `localhost:8000`.

### What to change

**Step 6a — Reverse proxy / TLS**

For production, place Carameli behind nginx or Caddy with a TLS certificate. Minimum
`nginx.conf` for the API:

```nginx
server {
    listen 443 ssl;
    server_name carameli.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/carameli.crt;
    ssl_certificate_key /etc/ssl/private/carameli.key;

    location / {
        proxy_pass         http://app:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Add an `nginx` service to `docker-compose.yml` or use an external load balancer.

**Step 6b — Twilio webhook URL**

After TLS is in place, set in Carameli's `.env`:

```dotenv
TWILIO_WEBHOOK_BASE_URL=https://carameli.yourdomain.com
```

This URL is used when provisioning DIDs and SIP domains so Twilio knows where to
send callbacks.

**Step 6c — VanillaSoft network access**

Ensure Carameli's host is routable from VanillaSoft's servers. If both are on a private
network, use a private IP / VPN rather than public internet.

---

## Task 7 — Minimum test coverage

**Why it matters:** Before relying on this service in production, the critical paths must
have automated tests.

### Priority test cases

Add to `tests/unit/` and `tests/integration/`:

1. **`test_customers.py`** — create, get, 404 on missing customer
2. **`test_phone_lines.py`** — add DID (mock Twilio), get, deactivate
3. **`test_sms.py`** — enable, send (mock Twilio), disable
4. **`test_webhooks.py`** — simulate Twilio `call-status` POST, assert DB write
5. **`test_inbound_routing.py`** — simulate Twilio `voice` POST, assert TwiML contains
   correct SIP URI when a pointer exists; assert fallback when no pointer exists
6. **`test_auth.py`** — assert 401 on missing token, 401 on wrong token, 200 on correct

Use `unittest.mock.patch` to stub `TwilioProvider` methods. Use `pytest-asyncio` and an
in-memory SQLite database (or test PostgreSQL schema) for DB tests.

---

## Task 8 — Secrets hygiene

**Why it matters:** Twilio credentials and API keys must not appear in logs.

### What to audit

1. Search all Python files for `logger.` calls that might include `twilio_auth_token`,
   `api_key`, `password`, or any credential field.
2. In `app/models/customer.py` add a `__repr__` that masks the token:

```python
def __repr__(self):
    return f"<Customer vs_customer_id={self.vs_customer_id} active={self.active}>"
```

3. In `app/services/twilio_provider.py`, confirm that exception messages logged on
   Twilio errors do not echo full request bodies containing auth tokens.

---

## Task 9 — `httpx` dependency

Task 4 (write-back) uses `httpx` for async HTTP. Add it to `requirements.txt` /
`pyproject.toml` if not already present:

```
httpx>=0.27
```

---

## Summary — Recommended Work Order

| Priority | Task | Effort |
|---|---|---|
| 1 | Task 1 — Inbound call routing (TwiML) | Medium |
| 2 | Task 2 — CORS for VanillaSoft origin | Low |
| 3 | Task 4 — Call write-back webhook | Medium |
| 4 | Task 5 — Recording retrieval endpoint | Low |
| 5 | Task 6 — Docker / TLS / network exposure | Medium |
| 6 | Task 7 — Test coverage | Medium |
| 7 | Task 3 — Per-customer key auth | Low (defer to Phase 2) |
| 8 | Task 8 — Secrets hygiene audit | Low |
| 9 | Task 9 — Add httpx dependency | Trivial |

Once Tasks 1–6 are complete, Carameli is production-ready for VanillaSoft integration.
