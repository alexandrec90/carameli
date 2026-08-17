# UI features needed for an end-to-end VanillaLand experience

_Compiled 2026-08-16 from `cloudli-functional-spec.md`, `vanillaland-voip-endpoint-audit.md`,
the current frontend (`frontend/src/routes.ts`, 27 routes), and the vsapi/webhook surface.
This is the gap list only — spec, not implementation. Supersedes the stale
`cloudli/carameli-frontend-gaps.md` for VanillaLand scope._

**Backend column:** `ready` = endpoint exists, UI-only work · `needs API` = model/data
exists but no readable endpoint · `needs producer` = the data itself is not captured yet.

## Cross-cutting prerequisite

The skin contract (`lib/dataPage.ts` descriptors) supports only flat list pages: no
detail routes (`:id`), no server-side pagination/sort, no tabs. Nearly everything below
that says "detail view" or "drill-down" needs that contract extended first.

## 1. Calls (inbound + outbound)

| # | Feature | Detail | Backend |
|---|---|---|---|
| 1.1 | Call log filters + pagination | `/calls` today has only date range + client-side text search. Add server-side filter by extension, by number, direction, status; pagination and sort. Equivalent of Cloudli's four CDR report pages (per extension / per number, by date / by period). | `VsCall/List` needs filter params |
| 1.2 | Call detail view (per `call_sid`) | The highest-value screen per `diagnostics-error-map.md`: legs/status timeline, duration, recording player, VanillaSoft notify state (`posted`, last error, retry count), correlated log lines on the `call_sid` join key. | needs API (single-call endpoint; `posted` is not in any response schema) |
| 1.3 | CDR drill-down reports | `/reports` gives only the aggregate summary grouped by extension or number. Add drill-down from a summary row to its underlying calls for a period. | mostly ready (compose 1.1) |
| 1.4 | DID → extension routing table | Pointers are write-only (`AddPointerToExtension`/`Delete…`); no UI can show which DID rings which extension. List view + add/remove. | needs API (no list/GET on `did_pointer`) |
| 1.5 | SCI routing page | Zip-code routing rules per extension (list, upsert, per-rule and per-extension enable/disable) plus pending per-call caller-ID preparations (unconsumed/expired) for outbound visibility. | needs API (`sci_rule`, `sci_preparation` have no list endpoints) |
| 1.6 | Auto-attendant toggle per line | `PhoneLine/SetAutoAttendant` exists; nothing in the UI sets it. | ready |
| 1.7 | Agent status / HUD panel | Live presence snapshot per extension from `/AgentStatus/{customerId}` (Jambonz calls + SIP registrations). Note the audit's parity gap: no `presence`/`idle`/`isSelf`/display-name fields yet. | ready (thin) |
| 1.8 | Click-to-call test tool | Small ops form driving `Callback/ByExtension` (ring agent, bridge contact) to verify the outbound path end to end. | ready |

## 2. SMS

| # | Feature | Detail | Backend |
|---|---|---|---|
| 2.1 | SMS number provisioning | Cloudli's "SMS Numbers" page. Toggle `sms_enabled` per DID; Enable/Disable endpoints exist but nothing in the UI calls them. | ready |
| 2.2 | Send-SMS composer | Outbound send form (`VsMessaging/Sms/Send` exists) for e2e verification. | ready |
| 2.3 | SMS message detail | Delivery-receipt chain, posted-to-VanillaSoft state, `message_sid` ↔ `referenceId` correlation. | needs API (`posted` unexposed) |
| 2.4 | Server-side SMS log filters | Filter `/sms` by number and direction, paginate. | needs filter params |

## 3. Recordings

| # | Feature | Detail | Backend |
|---|---|---|---|
| 3.1 | Recordings browser | List with date/number/extension filters, inline player, authenticated download. Today the `/calls` table renders the literal string "Yes" and never links `recording_url`; per-call fetch (`/recordings/{call_sid}`) exists but there is **no list endpoint**. | needs API (recordings list) |
| 3.2 | Per-line recording toggle | `PhoneLine/UpdateCallRecording` exists; no UI. | ready |
| 3.3 | Recording archive jobs | Request a bulk export (date range) via `VsArchive`, then a job history list with status and ZIP download. POST + single-`exportId` status exist; no per-customer job list. | needs API (archive list) |

## 4. Voicemail drop

| # | Feature | Detail | Backend |
|---|---|---|---|
| 4.1 | Drop-code assignment | Assign the per-customer 1–9 drop codes to audio assets (backend shipped in the code-resolution workflow); show current code map on the audio pages. | ready |
| 4.2 | Drop event detail | `/mailbox-drop` history exists; add failure reason / resolved-asset detail per event. | mostly ready |

## 5. Provisioning & account configuration

| # | Feature | Detail | Backend |
|---|---|---|---|
| 5.1 | Extension management list | `/extensions` is create-only. List existing extensions with SIP username, registration state, branch, notes; edit + deactivate. | ready (`/api/v1/extensions` GET/PATCH) |
| 5.2 | SIP credential lifecycle | `AccessCheck/AccountData` delivers the encrypted pending password exactly once, then erases it. UI needs an explicit pending-credential state and a regenerate action — the value can never be re-read. | partial (regenerate flow TBD) |
| 5.3 | Phone number editor | Cloudli's "VoIP Number" page: notes, caller-ID filter, 911 address, plus Carameli's flags (recording, SMS, auto-attendant) and branch. Today: add-by-area-code + deactivate only, no edit at all. | partial (`PATCH /api/v1/phone-lines` exists; E911/caller-ID fields don't) |
| 5.4 | Branch assignments view | `Branch/Assign` writes CRM branch metadata onto an extension or DID; nothing reads it back. | needs API (list) |
| 5.5 | Customer/tenant switcher | Every hook hardcodes `DEMO_VS_CUSTOMER_ID`. Admin needs a customer list + switcher for multi-tenant operation. | needs API (no cross-tenant customer list) |
| 5.6 | API token management | Create / rotate / revoke / last-used, plus token access logs (Cloudli's "API login token" page). Today: single masked read-only token. | needs API |

## 6. Logs & observability (the "Cloudli exposed logs" surface)

| # | Feature | Detail | Backend |
|---|---|---|---|
| 6.1 | Webhook delivery logs | Cloudli's "Subscriptions Logs" report. `/subscription-logs` is a permanent zero-row placeholder; needs a `subscription_events` table written at delivery time plus `VsWebhook/Logs/{customerId}` (already sketched in `plans/active/frontend-parity/plan-B-feature-verticals.md` §B5). | needs producer |
| 6.2 | Notify delivery health | Dashboard tile + drill-down for the Carameli→VanillaSoft notify loop: unposted backlog (`posted = false AND created_at < now() - 5 min` — today a psql query), per-event last error body/status, retry-drain indicator for the 30 s ARQ crons. | needs API (`posted` flags unexposed) |
| 6.3 | Reconciliation panel | Last-run timestamp, list of detected gaps (provider call/message with no local row), enable/lookback settings. Reconciliation detects but never backfills, so the gaps must render as an actionable list. Today: ERROR log lines only. | needs API (results are log-only) |
| 6.4 | VanillaSoft error feed | Filtered viewer over the `vs.*` records ingested by `/webhooks/vs-log` (NLog target). Deliberately log-only today; a UI needs a query surface. | needs producer/API |
| 6.5 | Application log viewer | Filterable table over `carameli.log` (format is machine-parseable with stable anchors: `notify POST failed`, `Provider error`, `Reconciliation:`). | needs API |
| 6.6 | E2E preflight status | Surface the last `vanillasoft-connectivity-preflight` / live-e2e run result as a pass/fail panel. | needs producer |

## 7. Settings

| # | Feature | Detail | Backend |
|---|---|---|---|
| 7.1 | Effective configuration panel | `/settings` is a static placeholder. Read-only, masked view of the env-derived config that decides whether the loop works: `VANILLASOFT_WEBHOOK_URL`/prefix, Jambonz/Telnyx/S3/Redis endpoints — plus reachability probes per dependency (extend `/health`, which already probes DB + Jambonz). | needs API |

## Already covered — no work needed

Phone line list/add/deactivate, extension create + available range, SMS log with CSV
export, call event log with CSV export, aggregate CDR summary, webhook subscription
CRUD, audio asset upload/playback (music, hold, ads, prompts, greetings, broadcast),
voicemail-drop history, agents/queues/skills CRUD, speed dials, exemption codes,
expansion modules. Orphans worth wiring for free: `useGroupExtensions`,
`useIntercomGroups`, `useMulticastGroups` hooks and the `VsConference`/`VsParking`
API clients all exist with no route/page.

## Deliberately out of scope for VanillaLand e2e

Cloudli surfaces with no bearing on the VanillaSoft integration: IVR/menu builder,
music-on-hold assignment, intercom/multicast, call parking live state, device (MAC)
provisioning, contacts/users directories (owned by the VanillaSoft CRM), permanent
conferences, call screening/blacklists.
