---
description: Backend and frontend structured logging conventions
paths:
   - app/**/*.py
   - frontend/src/**/*.ts
   - frontend/src/**/*.tsx
---

# Rule: Logging

All modules — backend and frontend — must emit structured, machine-readable logs
that land in a rotating text file. An AI agent should be able to `read` the log
file and reconstruct exactly what happened and why.

---

## Backend (Python)

### Setup

Logging is configured once at startup in `app/main.py`:

```python
from app.core.logging_config import configure_logging
configure_logging(log_level=settings.log_level, log_file=settings.log_file)
```

`app/core/logging_config.py` attaches two handlers to the root logger:
- **Console** (`StreamHandler`) — for docker logs / terminal
- **RotatingFileHandler** — writes to `logs/voicegateway.log`, 10 MB cap, 5 backups

### Log format

```
2026-02-21 14:30:00.123 | INFO     | app.api.vsapi.phone_lines:56 | Phone line added number=+15551234567 sid=PN...
```

Fields in order: `timestamp.ms | LEVEL | module:lineno | message`.

### Per-module logger

Every Python module that produces log output must declare its logger at module
scope — never inside a function:

```python
import logging
logger = logging.getLogger(__name__)
```

### What to log in a route handler

| Event | Level | Required fields |
| --- | --- | --- |
| Handler entry | `INFO` | all key identifiers (customer ID, phone number, ext, etc.) |
| 404 / 409 not found / conflict | `WARNING` | the missing identifier |
| Twilio error | `ERROR` | `vs_customer_id`, target number, `exc.code`, `exc.msg` |
| Validation / bad-request error | `WARNING` | the offending value |
| Successful mutation | `INFO` | result identifiers (new ID, SID, etc.) |

Pattern to follow (copy from existing routes):

```python
logger.info("Adding phone line vs_customer_id=%s area_code=%s number=%s", body.vs_customer_id, body.area_code, body.phone_number)
# ... logic ...
logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
# ... or ...
logger.error("Twilio error purchasing DID vs_customer_id=%s: %s", body.vs_customer_id, exc.msg)
# ... or ...
logger.info("Phone line added number=%s sid=%s", line.phone_number, line.twilio_sid)
```

Use `%s`-style lazy formatting — never f-strings inside `logger.*()` calls.

### Config / env vars

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Root log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `LOG_FILE` | `logs/voicegateway.log` | Path for the rotating file |

---

## Frontend (TypeScript / React)

### Logger utility

`frontend/src/lib/logger.ts` exports a `logger` singleton:

```typescript
import { logger } from '../lib/logger'

logger.info('Page loaded', { route: '/phone-lines' })
logger.warn('Retrying request', { attempt: 2 })
logger.error('API call failed', { status: 502, body: 'Twilio error' })
```

Internally it:
1. Writes to `console.*` in all environments.
2. Batches entries and POSTs them to `POST /vg/1.0.0/frontend-logs` every 2 s
   (errors flush immediately, `keepalive: true` covers page-unload).

The backend writes these as:
```
2026-02-21 14:30:00.123 | ERROR    | frontend:42 | [FRONTEND] API POST /vsapi/1.0.0/PhoneLine/Add failed | context={'status': 502, ...}
```

### Where to use the logger

| Location | What to log |
| --- | --- |
| `frontend/src/api/client.ts` | Already wired: every failed `fetch` is auto-logged as `ERROR` |
| `frontend/src/main.tsx` | Already wired: `window.error` + `unhandledrejection` global handlers |
| New page / component | Log key user-initiated actions at `INFO`, unexpected states at `WARN`/`ERROR` |

### Frontend log ingestion endpoint

`POST /vg/1.0.0/frontend-logs` (no auth required from the browser; the
`Authorization` header is sent automatically by `logger.ts` via `VITE_API_KEY`).

Request body:

```json
{
  "entries": [
    { "level": "error", "message": "API GET /health failed", "context": { "status": 503 } }
  ]
}
```

Returns `204 No Content`.

---

## Hard Rules

1. **Never `print()`** — use `logger.*()` instead.
2. **Never f-strings in log calls** — use `%s` lazy formatting so the string is
   only built if the level is active.
3. **Every new route handler** must log entry at `INFO` and failures at `WARNING`/`ERROR`.
4. **Every new frontend page or major component** should import `logger` and log
   at least entry (`INFO`) and any caught errors (`ERROR`).
5. **Do not log secrets** — never log `api_key`, `twilio_auth_token`, or any
   credential. Log the identifier (SID, customer ID) instead.
6. **Do not create new log files** — everything goes to `logs/voicegateway.log`
   via the root handler. The `[FRONTEND]` prefix on the `frontend` logger
   sub-namespace is the only namespacing needed.
