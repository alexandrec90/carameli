# Prototype Roadmap — Carameli × CRM

Roadmap for a fully functional prototype in which Carameli replaces the legacy VoIP vendor
telephony layer under CRM (legacy repo: `../legacy-crm`). Target flows: **send calls,
receive calls, send SMS, receive SMS, recordings back to CRM, SMS delivery receipts**,
plus **provisioning** (hard prerequisite — nothing works without `VsCustomer/Add` +
`PhoneLine/Add`).

Decisions locked in (2026-07-03):

- **Call engine:** jambonz.cloud (hosted) for the prototype. The self-hosted Jambonz compose
  stack stays in the repo for the later production migration — switching back is a config swap
  (`JAMBONZ_BASE_URL` + trunk registration).
- **CRM integration:** a new `CarameliService` implementing `legacy VoIP service interface` in
  LegacyCRM, using a static Bearer key and Carameli's native JSON contracts (no OAuth
  password-grant mimicry, no `CMVApiResponse` envelope mimicry).
- **CRM runtime:** remote staging server; Carameli posts webhooks to it via
  `CRM_WEBHOOK_URL`.

Deferred (post-prototype): voicemail drop (`VsMessageDrop` endpoint exists; the Jambonz
`voicemail-hook` handler does not), IVR/auto-attendant menus, agent-status dashboard (Clarity
poller replacement — isolated feature), bulk recording archive (`VsArchive`), E911/CNAM/number
porting, self-hosted Jambonz on a VPS.

---

## Current state (verified 2026-07-03)

| Flow | State |
| --- | --- |
| Outbound click-to-call | **Works** — real Jambonz REST (`app/api/vsapi/callback.py`, `calls.py`); pending-callback state is in-memory only (`app/services/callback_state.py`) |
| Inbound calls | **Partial** — `incoming-call` webhook answers; **no routing to an extension** (empty verb array), `dtmf-result` handler missing (`app/api/webhooks/call_status.py`) |
| SMS send | **Works** — real Telnyx (`app/api/vsapi/sms.py`); `enable_sms` PATCH is a no-op (never assigns `messaging_profile_id`) |
| SMS receive | **Stubbed** — `message.received` only logged; not persisted, not forwarded to CRM (`app/api/webhooks/sms_inbound.py`) |
| Recordings | **Partial** — URL captured on call-status into `call_events.recording_url`; no app-side S3 copy; retrieval endpoints return the raw provider URL |
| CRM write-back | HTTP POST + ARQ retry exist (`call_status.py`, `app/services/call_sync.py`) but payload/auth do not match CRM's `legacy notify controller` contract; skipped entirely when `CRM_WEBHOOK_URL` is blank |
| DID provisioning | Real Telnyx calls but a **`result["sid"]` KeyError bug** — every live `/PhoneLine/Add` returns 502 *after* buying the number (`app/api/vsapi/phone_lines.py` reads `sid`; the provider returns `provider_sid` in `telnyx.py`) |

Contract mismatch (resolved by the `CarameliService` decision): CRM's legacy clients call
`GET Callback/ByExtension/{customerId}/{ext}/{dest}`, while Carameli exposes
`POST /Callback/ByExtension` with a JSON body. The new client adopts Carameli's contract.

---

## Workstream A — Carameli backend gaps (ordered)

1. **Fix the DID provisioning bug** — `phone_lines.py` reads `result["sid"]`; the Telnyx
   provider returns `provider_sid`. Fix + regression test that mocks the provider with the
   *real* return shape. Also add the `country_code` kwarg to the `CarrierProvider` Protocol in
   `app/services/providers/base.py`.
2. **Inbound SMS pipeline** — in `sms_inbound.py` for `message.received`: persist via a new
   `sms_message_service.create_inbound` (+ repo method + migration if the schema needs an
   inbound direction/status), then POST CRM's `SmsMessage` shape (below) to
   `{CRM_WEBHOOK_URL}/notify/IncomingSmsMessage` with the `X-Log-Auth` header.
   Reuse the unposted/retry pattern from `call_sync.py` for failed forwards.
3. **Write-back contract alignment** — `call_status.py` currently posts an ad-hoc payload with
   a Bearer header. Align to `legacy notify controller`: `notify/IncomingCall` with the `IncomingCall`
   shape (below) and `X-Log-Auth: {CRM_WEBHOOK_SECRET}`. Keep the ARQ retry job
   working against the new payload builder.
4. **SMS delivery receipts** — extend `_handle_delivery_receipt` in `sms_inbound.py` to also
   POST `notify/IncomingSmsMessageDeliveryReceipt` (`SmsMessage` shape; uses `referenceId` +
   `status`).
5. **Inbound call routing** — in the `incoming-call` handler: when the DID's phone line maps to
   an extension/pointer, return a `dial` verb to the agent SIP URI (reuse the verb-building
   pattern from `outbound-answered` in `call_status.py`). Consult `did_pointers` (and later
   `sci_rules`). Implement the missing `dtmf-result` action-hook minimally so `gather` is not a
   dead end.
6. **Recording pipeline** — (a) enable Jambonz-side recording (`JAMBONZ_RECORD_ALL_CALLS`)
   pushing to the S3/MinIO bucket; (b) add an authenticated download endpoint that
   streams/presigns from S3 via `app/services/s3_service.py`, so CRM's `CMV Recording`
   service can `GET` an MP3 URL that stays fetchable; (c) POST `notify/CallRecording`
   (`CallRecording` shape, below) when a recording URL lands on call-status; (d) update the
   `recordings.py` / `calls.py` retrieval endpoints to return the Carameli-served URL, not the
   raw provider URL.
7. **SMS enable fix** — `telnyx.py` `enable_sms` must PATCH a real `messaging_profile_id` (new
   env var `TELNYX_MESSAGING_PROFILE_ID`); `disable_sms` keeps `None`.
8. **Move `pending_callbacks` to Redis** — the in-memory dict in `callback_state.py` breaks on
   restart/multi-replica. Redis is already in the stack; use it with a TTL. (Low priority for a
   single-instance prototype; required before production.)

Every item ships with tests in the same commit (mock at the `CarrierProvider` /
`CallEngineProvider` boundary; regression test first for bug fixes). Webhook-out payload shapes
get schema tests pinned to the CRM model shapes below.

### CRM webhook contracts Carameli must emit

All POSTs to `{CRM_WEBHOOK_URL}` (the staging `CRM VoIP API` base), with
header `X-Log-Auth: {CRM_WEBHOOK_SECRET}` matching the staging appSettings
`legacy shared-secret appSetting`. Source models live in `../legacy-crm/AppCode/<legacy-voip-api>/Models/`.

| Endpoint | Model | Fields |
| --- | --- | --- |
| `POST notify/IncomingCall` | `IncomingCall.cs` | `callId`, `callIdUuid`, `timestamp`, `from`, `fromName`, `fromNumber`, `to`, `toNumber`, `accountId`, `eventName` ∈ `callAnswered\|callHungup\|callReceived\|callInProgress`, `isInbound`, `customerId` |
| `POST notify/CallRecording` | `CallRecording.cs` | `accountId`, `endpoint`, `recordDate`, `endRecording`, `callerName`, `callerNumber`, `recordingFile` (fetchable MP3 URL), `isInbound`, `length`, `source`, `callId`, `calleeNumber`, `CustomerID` |
| `POST notify/IncomingSmsMessage` | `SmsMessage.cs` | `referenceId`, `isOutbound`, `smsProviderName`, `accountID`, `from`, `to` (array), `timestamp`, `message`, `mediaUrls` (array), `status`, `customerId` |
| `POST notify/IncomingSmsMessageDeliveryReceipt` | `SmsMessage.cs` | same shape; consumer uses `from`, `referenceId`, `customerId`, `status` |

## Workstream B — LegacyCRM changes

> **Status (implemented 2026-07-04, not live-verified — no .NET build in this env, defer to CI):**
> B1–B2 done. New `AppCode/<legacy-backend>/Carameli/` folder (`CarameliClient` +
> `ICarameliClient`, `CarameliService : legacy VoIP service interface`, `Models/CarameliResponseModels.cs`).
> The prototype surface is wired to Carameli's native routes; deferred members
> (`GetCustomerId`, SCI, message drop, pointers, auto-attendant, branch assign, archive,
> HUD account-data, plus the non-surface reads `GetCustomer`/`GetCustomerPhoneLines`/
> `GetPhoneLineInfo`) throw `NotImplementedException` with a feature-naming message.
> The DI switch reads the `VoipProvider` appSetting (`the legacy VoIP vendor` default | `Carameli`) via
> `legacy VoIP service factory` (`IsCarameliEnabled`/`the legacy VoIP service resolver`), which covers the
> PubApi Unity resolver and every non-DI caller; the 6 MS-DI hosts (VoipApi, Webservice,
> NotificationService, Task Service, SMSDripService, VoipLineCountUpdate) now resolve
> `legacy VoIP service interface` through it. Config keys `VoipProvider`/`CarameliApiBaseUrl`/`CarameliApiKey`
> added to the 8 configs that carry `the legacy VoIP vendorApiBaseUrl` (defaulting to the legacy VoIP vendor → no behavior
> change until flipped). MSTest+Moq coverage in `UnitTesting/Carameli/`. B3–B5 need no code.
> HudApi's separate `legacy VoIP service interface` type is intentionally left on the legacy VoIP vendor.

1. **`CarameliClient` + `CarameliService : legacy VoIP service interface`** in
   `AppCode/<legacy-backend>/Carameli/` (mirror the legacy vendor's folder layout). Static Bearer
   key from appSettings (`CarameliApiBaseUrl`, `CarameliApiKey`) — no OAuth2 DB rows, no token
   refresh. Implement the prototype surface first: callback-by-extension (as `POST` JSON per
   Carameli's contract), `SendSMS`, `CreateAccount` (`VsCustomer/Add`),
   `PhoneLine/Add|GetCount|UpdateCallRecording`, `VsExtension/Add|GetAvailable|Deactivate`,
   SMS `Enable`/`Disable`, `AreaCodes`. Stub the deferred members (archive export, message
   drop, HUD access) with clear `NotImplementedException` messages.
2. **DI switch** — register `CarameliService` as the `legacy VoIP service interface` implementation behind a
   config flag (`VoipProvider=Carameli|the legacy VoIP vendor`) so staging can flip back instantly.
3. **Webhook receiver: reuse as-is** — `legacy notify controller` needs **no changes** if Workstream A
   emits the exact shapes above. This is the simplification win: CRM's inbound side
   stays untouched.
4. **Recording fetch** — `Recordings.FindCallRecording` GETs the MP3 URL stored by
   `sp_CMVRecordingInsert`; as long as A6's Carameli URL is a plain authenticated GET
   (query-token or long-lived signed URL — decide during A6), no CRM code change.
5. **Retire from the prototype path**: the SOAP `CMVCallInfo.asmx` / `SMSWS.asmx` hops, and the
   Clarity poller (`CMV Agent Status` service stays pointed at Clarity or is stopped on
   staging).

## Workstream C — Infrastructure & accounts (human tasks)

> **Canada-only prototype scope.** The initial prototype targets Canadian calls + SMS only.
> That drops the US A2P 10DLC blocker entirely and defers the CRM staging hookup.
> **Minimal path: C1 → C3 → C4 → C6.** C2 is US-only (skipped); C5 is deferred until the
> CRM integration (M3/M5); C7 stays out of prototype scope. Buy **Canadian** DIDs in C6.

| # | Task | Cost (approx) | Notes |
| --- | --- | --- | --- |
| 1 | **Telnyx production account**: API key, Level-2 verification, SIP trunk (credential or FQDN) connection, messaging profile | PAYG; DID ~$1/mo; voice ~$0.005–0.007/min; SMS ~$0.004–0.008/msg | **Required.** Sandbox plumbing already exists (`TELNYX_SANDBOX=1`). The Messaging Profile ID feeds A7's `TELNYX_MESSAGING_PROFILE_ID`. Telnyx **Level-2 verification** (their KYC) is still required to enable messaging — this is a Telnyx account gate, unrelated to 10DLC. |
| 2 | ~~**A2P 10DLC registration** (brand + campaign) in the Telnyx portal~~ | ~$4 brand one-time; ~$2–15/mo campaign + carrier pass-through fees | **SKIPPED for Canada prototype.** 10DLC is a **US-only** regime (The Campaign Registry, US long codes); Canadian local long-code SMS is not part of it. Revisit only if/when US SMS is in scope. Caveats for Canadian SMS: **CASL** consent still applies, and Canadian carriers may filter unregistered A2P traffic at volume (fine for low-volume test-to-own-phone). |
| 3 | **jambonz.cloud account**: register Telnyx as a carrier (SIP trunk both directions), create an application pointing call/status hooks at Carameli's public URL; collect `JAMBONZ_ACCOUNT_SID` / `JAMBONZ_API_KEY`; set `JAMBONZ_BASE_URL` | Free trial, then usage-based — verify current pricing at signup | **Required.** Replaces the local jambonz/freeswitch/rtpengine compose services for the prototype. |
| 4 | **Public URL for Carameli** — ngrok with a static domain (free tier includes one) | Free | **Required.** Set `JAMBONZ_WEBHOOK_BASE_URL` + `TELNYX_WEBHOOK_BASE_URL`. Webhooks only — call media flows Telnyx ↔ jambonz.cloud and never touches ngrok. |
| 5 | **Staging reachability** — confirm the staging `VoipApi` URL + `legacy shared-secret appSetting`; set `CRM_WEBHOOK_URL` / `CRM_WEBHOOK_SECRET` to match | — | **Deferred** — only needed for the CRM integration path (M3/M5), not for standalone send/receive prototyping. Staging firewall must allow Carameli's egress IP. |
| 6 | Buy 1–2 test **Canadian** DIDs through the fixed `/PhoneLine/Add` flow (after A1) | ~$1–2/mo | **Required.** Point inbound voice at the jambonz.cloud application; SMS webhook at Carameli. |
| 7 | Later (post-prototype): VPS for Carameli + self-hosted Jambonz migration, E911, CNAM, number porting | ~$6–20/mo VPS | Explicitly out of prototype scope. |

## Milestones (each independently verifiable)

- **M0 — Docs + quick wins**: this document; A1 (DID `sid` bug) as the first code change.
- **M1 — Accounts live**: C1, C3, C4 done (C2 skipped for Canada; C5 deferred); `GET /health` reachable via the public URL; Telnyx
  sandbox integration tests pass (`TELNYX_SANDBOX=1`, see
  `docs/plans/active/test-coverage/track-c-provider.md`).
- **M2 — Outbound call + outbound SMS**: provision a customer + DID end-to-end (A1 verified
  live); click-to-call rings a real phone via jambonz.cloud; `Sms/Send` delivers (while 10DLC
  is pending, carriers may filter — use the toll-free fallback).
- **M3 — Inbound**: a real inbound call to the DID rings an extension (A5); inbound SMS is
  persisted and forwarded to staging (A2); delivery receipts forwarded (A4); call events land
  in CRM via `notify/IncomingCall` (A3) and `sp_CMVCallNotificationInsert` rows appear.
- **M4 — Recordings**: a recorded test call → file in MinIO/S3 → `notify/CallRecording` fires →
  CRM's recording service fetches the MP3 from Carameli's URL (A6).
- **M5 — Staging switchover**: `CarameliService` live behind `VoipProvider=Carameli` (B1–B2);
  an agent in staging CRM makes a call, sends/receives SMS, and sees the recording —
  all through Carameli.

## Verification

- Per change: targeted pytest for the touched modules + `ruff` / `mypy` (full runs stay in CI);
  webhook payload schema tests pinned to the CRM model shapes above.
- Per milestone: the live smoke checks listed above; on the Carameli side via
  `logs/runtime/carameli.log` and the `call_events` / `sms_messages` tables; on the CRM
  side via `sp_CMVCallNotificationInsert` / `sp_CMVRecordingInsert` rows and the staging UI.
- Before M5: run the ngrok-dependent integration tests tracked in `todo.md` (ngrok, Telnyx
  sandbox, `CRM_WEBHOOK_URL`).
