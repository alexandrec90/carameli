# Phase 02 — Honest Carameli webhook receiver in LegacyCRM

> Read `00-overview.md` first. Spans both repos: a new controller + MSTests in LegacyCRM
> (no local .NET build — defer compile verification to CI/staging), and a small config-only
> change in Carameli. This phase is the heart of the design.

## Part A — LegacyCRM: `CarameliNotifyController`

New file `AppCode/<legacy-voip-api>/Controllers/CarameliNotifyController.cs`
(namespace it distinctly, e.g. `CRM VoIP API.Controllers.Carameli` if that helps
scoping; the existing `the legacy notify controller` in the same folder is the reference for
attribute routing, `legacy auth-header filter` usage, and model binding — read it first).

### Contract

Same four endpoints and the **same request models** the existing controller uses
(`IncomingCall`, `CallRecording`, `SmsMessage` from
`AppCode/<legacy-voip-api>/Models/`) — Carameli's payload builders in
`app/services/crm_notify.py` stay untouched. Only the route prefix changes:

| Route | Replaces |
| --- | --- |
| `POST carameli/notify/IncomingCall` | `notify/IncomingCall` |
| `POST carameli/notify/CallRecording` | `notify/CallRecording` |
| `POST carameli/notify/IncomingSmsMessage` | `notify/IncomingSmsMessage` |
| `POST carameli/notify/IncomingSmsMessageDeliveryReceipt` | `notify/IncomingSmsMessageDeliveryReceipt` |

Auth: reuse `legacy auth-header filter` (validates `X-Log-Auth` against appSetting
`legacy shared-secret appSetting`) — Carameli already sends that header.

### Behavior: synchronous and honest

No `BackgroundTaskRunner`, no fire-and-forget. Call the same processing the legacy
controller calls — `the legacy cross-server notification handler(...)`,
`.ProcessCallRecordingInsert(...)`, `.ProcessIncomingSMSMessageFromCMV(...)` (all return
`BaseResponseVm { Success, Message }`), and the `SmsManager` path for delivery receipts —
**on the request thread**, then map the outcome:

| Outcome | Response |
| --- | --- |
| Processing succeeded | `200` |
| Model binding / null body / unparseable `customerId` | `400` + reason in body |
| Known business drop (e.g. customer has no CMV account — legacy controller logs a Warn and returns `Ok()`; see `the legacy notify controller` ~lines 178–203) | `422` + reason in body |
| `BaseResponseVm.Success == false` | `500` + `Message` in body |
| Unhandled exception | `500` + `ex.ToString()` in body |

Return bodies as JSON, e.g. `{ "error": "...", "detail": "..." }`. **Returning exception
detail in the body is deliberate** — this is a private server-to-server integration secured
by a shared secret, and that body is exactly what Carameli logs locally (phase 01). Also log
each failure to NLog under a `Carameli.*` logger name (phase 03 formalizes this; use
`LogManager.GetLogger("Carameli.NotifyController")` or the folder's wrapper if phase 03
already ran).

Reminder from `00-overview.md`: this **intentionally inverts** the always-ACK webhook
convention — Carameli persists unposted rows and retries every 30 s, so honest failure
codes are what make that retry loop a delivery guarantee.

### Simplifications vs the legacy controller (deliberate, Carameli-only)

- **Drop the `"asterisk"` recording-source skip** — Carameli always sends
  `source: "carameli"` (`RECORDING_SOURCE` in `crm_notify.py`).
- **Drop the `*`-truncation** of `To`/`ToNumber` (`LastIndexOf('*')` dance) — Carameli
  sends clean E.164 numbers, never CMV's `ext*number` format. Pass numbers through as-is;
  keep the same *field mapping* into `ProcessCallNotificationAsync` otherwise (inbound:
  `ToNumber` → cmvNumber, `To` → cmvExtension; outbound: `FromNumber` → cmvNumber,
  `From` → cmvExtension — copy from the legacy call site).
- **No silent drops**: every path that legacy handled with "log Warn, return Ok()" becomes
  an explicit `422` with the reason.

### Testability

`legacy cross-server handler` is instantiated inline in the legacy controller, which is
untestable. Put a thin interface in front of it — e.g. `ICarameliNotifyProcessor` with one
method per endpoint, default implementation delegating to `legacy cross-server handler` /
`SmsManager` — and constructor-inject it (mirror however `legacy notify controller` receives
`IBackgroundTaskRunner`; check the DI registration in `App_Start`/`Global.asax.cs` and
register the new pieces the same way). Keep the adapter dumb; all logic in the controller
stays branch-per-outcome so Moq can drive every row of the table above.

### Idempotency / at-least-once (investigate, then document)

Carameli retries until it gets a 200, so CRM may process a notify **twice** (e.g.
processed OK but the response timed out). Inspect `ProcessCallNotificationAsync` /
`sp_CMVCallNotificationInsert` and `ProcessCallRecordingInsert` for duplicate behavior:

- If duplicates are harmless (upsert/ignore), just document that in the controller header.
- If they create duplicate rows, add a cheap existence check keyed on
  `callId`+`eventName` (calls) / `referenceId` (SMS) before processing, and return `200`
  for an already-processed event. Do **not** build a dedupe table unless nothing simpler works.

### Timeout

The legacy controller went fire-and-forget because the CRMWS SOAP hop can be slow.
Synchronous processing means Carameli's client timeout must cover it: in
`app/services/crm_notify.py`, raise the `post_notification` timeout from `10.0` to
`30.0` (part B commit). If staging later shows >30 s processing, that's a CRM-side
performance bug to fix there — don't go back to fire-and-forget.

### Tests (same commit, `AppCode/UnitTesting/Carameli/`)

MSTest + Moq, mirroring the existing files in that folder (read one for conventions —
naming, project registration in the `.csproj`). Cover per endpoint: happy path (processor
mocked to `Success=true` → 200 + processor called with correctly mapped fields), processor
`Success=false` → 500 with `Message` in body, processor throws → 500 with exception text,
business-drop condition → 422, and the field-mapping simplifications (E.164 passthrough —
assert **no** truncation; `source:"carameli"` recording is processed, not skipped).

## Part B — Carameli: switchable notify prefix

1. `app/core/config.py`: add `crm_notify_prefix: str = "notify"` (+ `.env.example`
   entry with a comment: legacy = `notify`, honest receiver = `carameli/notify`).
2. `app/services/crm_notify.py`: the four `*_PATH` constants become suffixes
   (`IncomingCall`, `CallRecording`, ...); build the URL as
   `{base}/{settings.crm_notify_prefix}/{suffix}` (normalize slashes). Callers in
   `call_status.py`, `sms_inbound.py`, `call_sync.py`, `sms_sync.py` pass the same
   constants — verify nothing else hardcodes `notify/`.
3. Bump the notify timeout to `30.0` (see above).
4. Tests: extend `tests/unit/test_crm_notify.py` — URL built correctly for both
   prefix values (monkeypatch the setting, assert the URL the mocked client was called
   with), plus existing suites for `call_sync`/`sms_sync`/webhooks still green:
   `pytest tests/unit/test_crm_notify.py tests/unit/test_call_sync.py tests/unit/test_sms_inbound_pipeline.py tests/unit/test_crm_writeback.py`
   then `ruff` / `mypy` on touched files.

## Rollout (human steps, record in the commit/PR body)

1. Merge + deploy LegacyCRM to staging (controller is additive; legacy routes untouched).
2. Smoke: `curl -X POST https://wwac.crm.org/<apppath>/carameli/notify/IncomingCall`
   with the auth header and a sample payload → expect an honest 200/4xx/5xx, not a blind 200.
3. Flip `CRM_NOTIFY_PREFIX=carameli/notify` in Carameli's `.env`; restart; watch
   `logs/runtime/carameli.log` for the first `notify POST ok` lines.
4. Rollback = flip the prefix back to `notify`.
