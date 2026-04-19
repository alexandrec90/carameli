---
description: Frontend structured logging conventions (TypeScript / React)
paths:
  - frontend/src/**/*.ts
  - frontend/src/**/*.tsx
---

# Rule: Frontend Logging

## Logger utility

`frontend/src/lib/logger.ts` exports a `logger` singleton:

```typescript
import { logger } from '../lib/logger'

logger.info('Page loaded', { route: '/phone-lines' })
logger.warn('Retrying request', { attempt: 2 })
logger.error('API call failed', { status: 502, body: 'Provider error' })
```

Internally it:

1. Writes to `console.*` in all environments.
2. Batches entries and POSTs them to `POST /vg/1.0.0/frontend-logs` every 2 s
   (errors flush immediately, `keepalive: true` covers page-unload).

The backend writes these as:

```text
2026-02-21 14:30:00.123 | ERROR    | frontend:42 | [FRONTEND] API POST /vsapi/1.0.0/PhoneLine/Add failed | context={'status': 502, ...}
```

## Where to use the logger

| Location | What to log |
| --- | --- |
| `frontend/src/api/client.ts` | Already wired: every failed `fetch` is auto-logged as `ERROR` |
| `frontend/src/main.tsx` | Already wired: `window.error` + `unhandledrejection` global handlers |
| New page / component | Key user-initiated actions at `INFO`, unexpected states at `WARN`/`ERROR` |

## Log ingestion endpoint

`POST /vg/1.0.0/frontend-logs` (authenticated via session cookie — `logger.ts` sends `credentials: 'include'`).

```json
{
  "entries": [
    { "level": "error", "message": "API GET /health failed", "context": { "status": 503 } }
  ]
}
```

Returns `204 No Content`.

## Hard Rules

1. **Every new page or major component** must import `logger` and log at least entry (`INFO`) and caught errors (`ERROR`).
2. **Do not log secrets** — log the identifier (SID, customer ID) instead.
