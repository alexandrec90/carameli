---
description: Webhook handler patterns for Jambonz and Telnyx callbacks
paths:
  - app/api/webhooks/**/*.py
---

# Rule: Webhook Handlers

## Signature Validation

Every webhook handler must validate the request signature **before** parsing the body:

- **Jambonz**: HMAC-SHA256 via `X-Jambonz-Signature` header, secret in `settings.jambonz_webhook_secret`.
- **Telnyx**: Ed25519 via `telnyx-signature-ed25519` + `telnyx-timestamp` headers,
  public key in `settings.telnyx_webhook_secret`. Includes 300 s replay protection.

Validation is skipped when the secret is not configured (dev/CI mode).

## Handler Pattern

1. Read `raw_body = await request.body()` (needed for signature verification).
2. Validate signature.
3. Parse JSON — return 400 on failure, never raise unhandled.
4. Log at INFO with key identifiers (call_sid, from/to numbers, event_type).
5. Persist the event to the database.
6. Fire any downstream side-effects (e.g., VanillaSoft write-back) — wrap in
   try/except so webhook acknowledgement is never blocked by downstream failures.
7. Return a success response (`{"status": "ok"}` or 204) — external providers
   retry on non-2xx, so always acknowledge receipt even if internal processing fails.

## Response Codes

| Code | Meaning |
| --- | --- |
| 200 / 204 | Event received and processed (or will be retried internally) |
| 400 | Non-JSON body or wrong payload shape |
| 403 | Signature validation failed |

## Don'ts

- Never return 5xx for a business-logic failure — it triggers provider retries.
- Never log the full raw body (may contain PII). Log identifiers only.
- Never block the response on external HTTP calls (VanillaSoft, etc.) — failures
  are caught and retried by the background job.
