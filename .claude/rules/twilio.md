---
description: DEPRECATED — Twilio-specific conventions (legacy fallback provider only)
paths:
  - app/services/providers/carrier/twilio.py
  - app/services/providers/engine/twilio.py
---

# Rule: Twilio (Legacy Fallback Provider)

Twilio is kept as a fallback provider only. Do not write new business logic against
Twilio directly. See `.claude/rules/voip-providers.md` for the authoritative
provider abstraction conventions.

## What still applies when working on the Twilio provider impls

- Catch `twilio.base.exceptions.TwilioRestException`; log `exc.code` + `exc.msg`
  before re-raising as `HTTPException(502)`.
- In unit tests, mock the Twilio client — never make real API calls.
- In integration tests, use Twilio test credentials (`TWILIO_ACCOUNT_SID` starting
  with `ACtest...`).
- Store all phone numbers in **E.164 format**.
- Each customer gets one SIP Credential List and one SIP Domain
  (`{customer_id}.sip.twilio.com`). Store `sip_credential_sid` and
  `twilio_domain_sid` on the `extensions` row.
- Validate `X-Twilio-Signature` on every inbound webhook; reject with `HTTP 403`
  on failure.
- Return TwiML as `Response(content=twiml_string, media_type="text/xml")`.
