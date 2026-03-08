---
description: VoIP provider abstraction — conventions for carrier and call-engine providers
paths:
  - app/services/providers/**/*.py
  - app/services/call_control.py
  - app/services/did_manager.py
  - app/api/vsapi/phone_lines.py
  - app/api/vsapi/extensions.py
  - app/api/vsapi/sms.py
  - app/api/vsapi/voicemail_drop.py
  - app/api/webhooks/**/*.py
  - tests/**/*.py
---

# Rule: VoIP Provider Abstraction

Carameli uses a two-layer provider abstraction so the carrier (who owns the
phone numbers / SIP trunk) and the call engine (what controls the call) can be
swapped independently via environment variables.

See `docs/voip-migration-plan.md` for the full migration rationale and phased plan.

## Provider Layers

| Layer | Env var | Active impl |
|---|---|---|
| Carrier (DIDs, SMS, SIP trunk) | `CARRIER_PROVIDER` | `telnyx` |
| Call engine (call control, recording) | `CALL_ENGINE_PROVIDER` | `jambonz` |

## Directory Layout

```
app/services/providers/
  base.py              ← Protocol interfaces (CarrierProvider, CallEngineProvider)
  factory.py           ← reads env vars, returns provider singletons
  carrier/
    telnyx.py          ← active carrier
  engine/
    jambonz.py         ← active engine
```

Business logic in `call_control.py` and `did_manager.py` only imports from
`services/providers/base.py` — never from a concrete provider directly.

## Provider Interfaces (`base.py`)

```python
class CarrierProvider(Protocol):
    async def search_numbers(self, area_code: str, count: int) -> list[PhoneNumber]: ...
    async def provision_number(self, number: str) -> ProvisionedNumber: ...
    async def release_number(self, number: str) -> None: ...
    async def send_sms(self, from_: str, to: str, body: str) -> SmsResult: ...

class CallEngineProvider(Protocol):
    async def initiate_call(self, from_: str, to: str, webhook_url: str, **opts) -> CallResult: ...
    async def hangup_call(self, call_id: str) -> None: ...
    async def start_recording(self, call_id: str) -> RecordingResult: ...
    async def stop_recording(self, call_id: str) -> None: ...
    async def get_call_status(self, call_id: str) -> CallStatus: ...
```

## Error Handling

- Wrap every provider SDK call in a `try/except` for that provider's exception type.
- Log the error code + message before re-raising.
- Re-raise all provider errors as `HTTPException(502)` so callers get a clean non-2xx.
- Telnyx: catch `telnyx.error.TelnyxError`
- Jambonz: catch `httpx.HTTPStatusError` (Jambonz REST API is HTTP-based)

## Client Lifecycle

- Instantiate provider clients once at application startup (via FastAPI `lifespan`),
  store on `app.state`, inject via a FastAPI dependency.
- Never instantiate a provider client inside a route handler or per-request.
- In unit tests, always mock at the provider interface boundary — never make real
  API calls to Telnyx or Jambonz.
- In integration tests, use sandbox/test credentials for the active provider.

## Phone Numbers

- Store and compare all phone numbers in **E.164 format** (`+15551234567`).
- Normalize on ingress (incoming webhooks and API requests alike).
- When provisioning a DID, always configure the voice webhook URL and SMS webhook
  URL on the carrier side to point to Carameli's public endpoints.

## Webhooks

- Webhook handlers must return `200 OK` quickly. Push heavy work (DB writes) to an
  APScheduler job or background task.
- **Jambonz** fires call status events as JSON POST to `/webhooks/jambonz/call-status`.
  Respond with a JSON verb array to control the call (analogous to TwiML).
- **Telnyx** fires SMS inbound events as JSON POST to `/webhooks/telnyx/sms-inbound`.
- Validate webhook authenticity on every inbound request:
  - Jambonz: shared secret HMAC header (`JAMBONZ_WEBHOOK_SECRET`)
  - Telnyx: `telnyx.webhook.Webhook.construct_event(...)` with signing secret

## SIP / Extensions

- Each customer gets one SIP credential set and one SIP domain.
- Store the provider-internal IDs (e.g. `telnyx_credential_id`, `jambonz_account_sid`)
  on the `extensions` row so they can be cleaned up on deactivation.

## Voicemail Drop / AMD

- Pass AMD (answering machine detection) option when initiating a call.
- On machine detection in the status callback, play the drop audio.
- On human answer, the call proceeds normally; do not auto-play the drop.
- AMD option names differ per engine — set them in the engine provider impl, not in
  business logic.

## Recordings

- Store the recording URL/reference in `call_events.recording_url`.
- After the call ends, copy recordings to S3 and store the signed URL.
- Delete recordings from the provider after copying to avoid storage charges.

## Adding a New Provider

1. Create `app/services/providers/carrier/<name>.py` or `engine/<name>.py`.
2. Implement all methods from the corresponding Protocol in `base.py`.
3. Register it in `factory.py` under a new `CARRIER_PROVIDER` / `CALL_ENGINE_PROVIDER`
   env var value.
4. Add unit tests mocking at the HTTP/SDK boundary.
5. Add the new env vars to `.env.example` and `core/config.py`.
