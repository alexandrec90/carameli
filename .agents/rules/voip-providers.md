---
description: Telnyx carrier and Jambonz call-engine abstraction boundaries
paths:
  - app/services/providers/**/*.py
  - app/services/reconciliation.py
  - app/services/agent_status_sync.py
  - app/api/vsapi/area_codes.py
  - app/api/vsapi/callback.py
  - app/api/vsapi/calls.py
  - app/api/vsapi/phone_lines.py
  - app/api/vsapi/sms.py
  - app/api/vsapi/voicemail_drop.py
  - tests/**/test_*telnyx*.py
  - tests/**/test_*jambonz*.py
  - tests/**/test_*provider*.py
---

# VoIP provider boundaries

`CarrierProvider` owns DIDs, SMS, area codes, and carrier records.
`CallEngineProvider` owns call control, SIP/agent state, and recordings. Both Protocols
live in `app/services/providers/base.py`; `factory.py` selects the configured Telnyx or
Jambonz implementation.

- Only `factory.py` may select or import a concrete provider for application use.
- HTTP handlers use the startup instances on `request.app.state`.
- ARQ workflows accept Protocol-typed providers or create one instance at worker
  startup. Never construct a client inside an item-processing loop.
- Keep provider-specific request fields, error types, and option names inside the
  concrete implementation. Translate failures at the HTTP or job boundary.
- Store and compare phone numbers in E.164 form; normalize at ingress.
- Persist provider identifiers needed for deactivation/reconciliation, but never return
  credentials or API keys from schemas.
- Mock the Protocol in service/handler tests. Concrete-provider tests may mock its HTTP
  boundary; live-provider tests require the explicit paid marker hierarchy.
- Webhook authentication and acknowledgement rules live in `webhooks.md`.

Adding a provider requires a complete Protocol implementation, factory registration,
configuration and `.env.example` fields, focused tests, and cleanup/lifecycle coverage.
