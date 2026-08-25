---
description: Authentication and acknowledgement rules for Jambonz and Telnyx callbacks
paths:
  - app/api/webhooks/**/*.py
  - tests/**/test_*webhook*.py
---

# Webhooks

Authenticate the exact raw request bytes before parsing JSON:

- Jambonz: HMAC-SHA256 from `X-Jambonz-Signature` using
  `settings.jambonz_webhook_secret`.
- Telnyx: Ed25519 from `telnyx-signature-ed25519` over `<timestamp>|<body>` using the
  configured public key, with the existing 300-second replay window.

Missing or invalid authentication returns 403; malformed JSON/schema returns 400/422,
never 500. Local/CI bypass is allowed only through the existing explicit empty-secret
configuration—do not add handler-specific bypasses.

Log provider event identifiers, not raw payloads, message bodies, phone-number content,
or credentials. Persist enough state for idempotency and reconciliation. Acknowledge
accepted events promptly; downstream CRM/provider work must be retriable and
must not turn a successfully persisted callback into a provider retry storm.
