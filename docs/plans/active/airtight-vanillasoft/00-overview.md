# Airtight Carameli ⇄ VanillaSoft Error Visibility — Implementation Plan

Goal: once Carameli is exposed via ngrok and wired to the remote VanillaSoft staging
server (`wwac.vanillasoft.org`), **every error on either side of the integration must land
somewhere a local coding agent can read** — plus a live E2E suite for the integration flows
(backend only, no Carameli front-end).

This `00-overview.md` is shared context. Phases `01`–`05` are each scoped to a single
coding-agent session and can be executed in order. Each phase file is self-contained but
assumes this overview was read first. Phases 01, 03, 04, 05 are Carameli (Python) work;
phase 02 spans both repos (VanillaLand .NET + a small Carameli config change).

---

## The two repos

| Repo | Path | Role |
| --- | --- | --- |
| Carameli | `c:\Users\Administrator\Desktop\vs_code\carameli` | FastAPI VoIP microservice (this repo; all guardrails in `CLAUDE.md` apply) |
| VanillaLand | `c:\Users\Administrator\Desktop\vs_code\VanillaLand` | Legacy .NET monolith; **our branch, ours to change freely**. Deployed to staging at `wwac.vanillasoft.org`. No local .NET build — write code + MSTest, defer build/run verification to CI/staging. |

Existing integration (all already implemented and tested):

- **Carameli → VanillaSoft**: `app/services/vanillasoft_notify.py` POSTs
  `notify/IncomingCall|CallRecording|IncomingSmsMessage|IncomingSmsMessageDeliveryReceipt`
  to `{VANILLASOFT_WEBHOOK_URL}` with header `X-Cloudli-Auth: {VANILLASOFT_WEBHOOK_SECRET}`.
  Failed posts persist as unposted rows (`call_events.posted`, `sms_messages.posted`) and are
  retried every 30 s by ARQ crons (`app/services/call_sync.py`, `app/services/sms_sync.py`).
- **VanillaSoft → Carameli**: `AppCode/VanillaSoft.Backend/Carameli/` (`CarameliClient`,
  `CarameliService : ICloudliService`) calls Carameli's REST API with a static Bearer key,
  selected by the `VoipProvider=Carameli` appSetting via `CloudliServiceFactory`.
- **VanillaSoft receiver today**: `AppCode/VanillaSoft.VoipApi/Controllers/CloudliController.cs`
  — auth via `CloudliHeaderAttribute` (compares `X-Cloudli-Auth` to appSetting `CloudliAuthValue`).

## The core architectural decision: the honest receiver

Today `CloudliController` returns `Ok()` **before** processing (fire-and-forget via
`BackgroundTaskRunner`); DB/SOAP failures die in a background `catch { Logger.Error(ex) }`
visible only in staging's NLog files. A 200 to Carameli means "queued", not "landed".

The plan inverts this **for the Carameli routes only** (phase 02): a new
`CarameliNotifyController` processes synchronously and returns 200 **only after the DB write
succeeded**; failures return 4xx/5xx **with the error detail in the response body**. Because
Carameli already persists-and-retries unposted events, that retry loop becomes the delivery
guarantee, and VanillaSoft-side processing errors transport themselves back to Carameli's log.
Most of the "ship VanillaSoft's logs around" problem disappears.

> ⚠ This deliberately **inverts** Carameli's own inbound-webhook rule
> (`.claude/rules/webhooks.md`: "always ACK, never 5xx"). That rule exists because Jambonz/
> Telnyx retries are outside our control. Here the *sender* (Carameli) owns durable retry, so
> honest failure codes are the correct contract. Do not "fix" the new controller to always-ACK.

Residual channels that still need covering:

| Failure mode | Covered by |
| --- | --- |
| Carameli's own errors (500s, provider errors, webhook failures) | Already: `logs/runtime/carameli.log` (global 500 handler in `app/main.py`, per-handler logging rules) |
| VanillaSoft rejects/fails a notify | Phase 01 (log response body) + phase 02 (honest receiver puts real errors in that body) |
| VanillaSoft-side errors *outside* an HTTP exchange Carameli sees (exceptions inside `CarameliClient`/`CarameliService`, notify processing that can't be made synchronous) | Phase 03: scoped NLog → `POST /webhooks/vs-log` on Carameli → `carameli.log` |
| Webhooks that never arrive (ngrok down, laptop asleep) | Phase 04: reconciliation cron diffing provider records vs local tables. Plus the ngrok local inspector (`http://127.0.0.1:4040/api/requests`) documented in phase 05. |
| Proving the whole loop works | Phase 05: live E2E suite behind a `live_e2e` marker |

## Deploy-ordering constraint

Staging must deploy the new `CarameliNotifyController` **before** Carameli starts posting to
the new routes. Phase 02 therefore makes the notify path prefix a Carameli setting
(`VANILLASOFT_NOTIFY_PREFIX`, default `notify` = legacy CloudliController) that is flipped to
`carameli/notify` only after the staging deploy. Same idea for phase 03: the NLog config
change is a deliverable (exact XML) that a human applies on staging.

## Decoupling rule for VanillaLand changes

All new VanillaLand code lives in Carameli-scoped locations and touches nothing shared:

- Controller: `AppCode/VanillaSoft.VoipApi/Controllers/CarameliNotifyController.cs`
  (own routes `carameli/notify/...`; reuses `CloudliHeaderAttribute` + existing models).
- Client-side code already lives in `AppCode/VanillaSoft.Backend/Carameli/`.
- NLog loggers: every Carameli class logs under a `Carameli.*` logger name (phase 03), so
  NLog routing rules affect Carameli traffic only.
- Tests: `AppCode/UnitTesting/Carameli/` (MSTest + Moq, mirroring existing files there).

Existing Cloudli/CMV/Clarity code paths keep working unchanged; the DI switch
(`VoipProvider` appSetting) can always flip staging back.

## Carameli guardrails that apply to every phase (from `CLAUDE.md` — read it)

- Tests in the same commit, every time. Targeted pytest only (`pytest tests/unit/test_<module>.py`),
  never the full suite; `ruff`, `mypy`, `py_compile` per change; full runs stay in CI.
- No new pip deps without updating `requirements*.in` + recompiling both locks (`--universal`).
  All phases below are designed to need **no new dependencies**.
- Everything logs to `logs/runtime/carameli.log` — never create a new log file.
- No f-strings in log calls; never log secrets or full raw bodies (identifiers only,
  truncated error text is fine).
- Async-only I/O; Pydantic schemas on every endpoint; new webhook endpoints follow
  `.claude/rules/webhooks.md` (validate shared-secret header before parsing; skip when
  secret unconfigured = dev mode).
- Model changes require an Alembic migration (`app/CLAUDE.md`) — only phase 01
  optionally touches a model.
- Docker stack needed for pytest; if not running, write the tests anyway and defer
  execution to CI.

## Config additions (summary across phases)

| Setting (`app/core/config.py`) | Default | Phase | Purpose |
| --- | --- | --- | --- |
| `vanillasoft_notify_prefix` | `"notify"` | 02 | Path prefix for notify POSTs; flip to `"carameli/notify"` post staging-deploy |
| `reconciliation_enabled` | `False` | 04 | Gate the provider-diff cron |
| `reconciliation_lookback_minutes` | `60` | 04 | Diff window |

`/webhooks/vs-log` (phase 03) authenticates with the existing
`vanillasoft_webhook_secret` via `X-Cloudli-Auth` — same trust pair, both directions, no new
secret. E2E env vars are listed in phase 05. Update `.env.example` whenever a setting is added.

## Phase index

- `01-response-body-logging.md` — Carameli: capture VanillaSoft's error body on failed
  notifies (today only the status code is logged). Tiny; ships alone; useful immediately.
- `02-honest-receiver.md` — VanillaLand: `CarameliNotifyController` (synchronous, honest
  status codes, Carameli-only routes) + MSTest; Carameli: `vanillasoft_notify_prefix` setting.
- `03-vs-log-ingest.md` — Carameli: `POST /webhooks/vs-log` ingest endpoint; VanillaLand:
  dedicated `Carameli.*` NLog loggers; deliverable: exact `NLog.config` XML for staging.
- `04-reconciliation.md` — Carameli: ARQ cron diffing Telnyx/Jambonz records against
  `call_events`/`sms_messages`; catches webhooks that never arrived.
- `05-e2e-and-diagnostics.md` — Carameli: live E2E suite (`live_e2e` marker) + a
  diagnostics doc mapping every failure mode to where its evidence lands (incl. the ngrok
  inspector API).
