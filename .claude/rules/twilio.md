# Rule: Twilio SDK Usage

## Client Lifecycle

- Instantiate `twilio.rest.Client` once at application startup (via FastAPI
  `lifespan`), store on `app.state`, inject via a FastAPI dependency.
- Never instantiate the client inside a route handler or per-request.
- In unit tests, always mock the client — never make real Twilio API calls.
- In integration tests, use **Twilio test credentials**
  (`TWILIO_ACCOUNT_SID` starting with `AC...test...`) to avoid charges and get
  predictable responses.

## Error Handling

- Wrap every Twilio SDK call in `try/except TwilioRestException`.
- Log `exc.code` and `exc.msg` before re-raising.
- Handle these Twilio error codes explicitly in DID provisioning:
  - `21211` — invalid phone number
  - `21606` — number not owned by this account
  - `21422` — invalid area code
- Re-raise all Twilio errors as `HTTPException(502)` so VanillaSoft gets a
  clear non-2xx response.

## Webhook Security

- **Always validate** the `X-Twilio-Signature` header on every incoming webhook
  request using `twilio.request_validator.RequestValidator`.
- Reject requests that fail signature validation with `HTTP 403`.
- Webhook handlers must return `200 OK` quickly. Push heavy work (DB writes,
  VanillaSoft API calls) to an APScheduler job or background task to avoid
  Twilio timeout retries.
- Return TwiML as:
  ```python
  Response(content=twiml_string, media_type="text/xml")
  ```

## Phone Numbers

- Store and compare all phone numbers in **E.164 format** (`+15551234567`).
- Normalize on ingress (incoming Twilio webhooks and VanillaSoft requests alike).
- When purchasing a DID, always set both `voice_url` and `sms_url` to the
  corresponding VoiceGateway webhook endpoints.

## SIP / Extensions

- Each customer gets exactly **one** Twilio SIP Credential List and one SIP Domain
  (`{customer_id}.sip.twilio.com`).
- Extension usernames must be unique within their credential list.
- Store `sip_credential_sid` and `twilio_domain_sid` on the `extensions` row so
  they can be cleaned up on deactivation without an extra Twilio lookup.

## Voicemail Drop / AMD

- Use `machine_detection='Enable'` on `client.calls.create(...)`.
- On `AnsweredBy=machine_start` in the status callback, play audio via TwiML
  `<Play>` verb.
- On `AnsweredBy=human`, hang up immediately (do not play the drop).

## Recordings

- Store `RecordingUrl` from the status callback in `call_events.recording_url`.
- In dev, local disk is acceptable. In production, copy recordings to S3 and
  store the signed URL.
- Delete recordings from Twilio after copying to avoid storage charges.
