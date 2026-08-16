# Cloudli Feature Gap Analysis

Comparison of Cloudli's advertised features against Carameli's current implementation.
Use this as a backlog reference — features are grouped by effort, not priority. Endpoint-level
contract details live in [the VanillaLand VoIP endpoint audit](../vanillaland-voip-endpoint-audit.md).

Last audited: 2026-08-16.

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Implemented |
| ⚠️ | Partial |
| ❌ | Missing |
| n/a | Belongs to VanillaSoft's CRM rather than Carameli's VoIP boundary |

---

## Feature Status

### Core Infrastructure

| Feature | Status | Notes |
|---|---|---|
| Hosted IP Telephony | ✅ | Jambonz + FreeSWITCH |
| Admin Portal (Web) | ⚠️ | 3D UI exists for Lines/Extensions only |
| HD Voice Quality | ✅ | FreeSWITCH handles codec negotiation |
| IVR (press 1 for Sales…) | ⚠️ | Simple DTMF auto-attendant routing exists; multi-level menus and prompts do not |
| Customer Account Provisioning | ✅ | `VsCustomer/Create` creates the Carameli tenant/auth boundary; Telnyx and Jambonz are not partitioned into per-customer sub-accounts |
| Branch / Sub-group Assignment | ❌ | CMV `Branch/Assign` links extensions to organizational branches; no equivalent in Carameli |
| REST API | ✅ | FastAPI |

### Call Management

| Feature | Status | Notes |
|---|---|---|
| Call Routing / Forwarding | ⚠️ | DID→extension pointers exist; no time-based/conditional routing |
| Callback / Click-to-Call | ✅ | `POST /Callback/ByExtension` bridges the two Jambonz legs |
| Enhanced Voicemail | ❌ | No mailbox, greetings, or email/SMS delivery |
| Call Queues + Hold Music | ❌ | |
| Call Parking | ❌ | |
| Presence / BLF | ⚠️ | ARQ polls Jambonz calls and SIP registrations; `GET /AgentStatus/{customerId}` exposes call/registration state, but not user-set presence or SIP BLF subscriptions |
| Call Screening / Blacklist | ❌ | SCI zip-code filter exists but is not the same thing |

### Mobile & Desktop Apps

| Feature | Status | Notes |
|---|---|---|
| Softphone (iOS/Android/Desktop) | ❌ | Extension identifiers exist, but Jambonz SIP credential provisioning and one-time secret delivery do not |
| Business SMS | ✅ | Send/receive via Telnyx |
| SMS Delivery Receipts | ✅ | Telnyx `message.finalized` updates delivery state and forwards `notify/IncomingSmsMessageDeliveryReceipt` to VanillaSoft |
| MMS | ❌ | Telnyx supports it; Carameli doesn't yet |
| Team Messaging (internal chat) | ❌ | Different product category entirely |
| Contact Sync (Microsoft 365) | ❌ | |

### Contact Centre & Supervision

| Feature | Status | Notes |
|---|---|---|
| Real-time Call Dashboard | ⚠️ | Grafana for infra metrics; no call-agent UI |
| Skills-based / Smart Queuing | ❌ | |
| Monitor / Whisper / Barge-in | ❌ | FreeSWITCH supports all three natively |
| Call Analytics / CDR Reporting | ⚠️ | `call_events` table exists; no aggregations or UI |
| IR Filter Management (VanillaSoft PubApi) | n/a | CRM lead-distribution filters over projects/users/contact fields; not a VoIP or SCI provider capability |

### IP Fax

| Feature | Status | Notes |
|---|---|---|
| Virtual Fax (email ↔ fax) | ❌ | |
| T.38 SIP Trunks | ❌ | Telnyx supports T.38 |
| HIPAA-compliant encrypted fax | ❌ | |

### Connectivity & Numbers

| Feature | Status | Notes |
|---|---|---|
| SIP Trunking | ✅ | Telnyx |
| Business Internet / SD-WAN | ❌ | Physical ISP product — out of scope |
| Mass Notifications | ⚠️ | Voicemail drop exists; no bulk SMS templating |
| Local + Toll-Free Numbers | ✅ | Telnyx search handles the seven NANP toll-free prefixes and local area codes |
| International Numbers | ✅ | DID search/provisioning accepts ISO country codes; availability still depends on the carrier/account |
| Number Porting | ❌ | Telnyx supports LOA porting via API |

---

## Implementation Effort

### Low effort — 1–3 days each

Thin API wrappers over capabilities already in the stack.

- **Call Screening / Blacklist** — `blocked_numbers` table + webhook intercept in the Jambonz call hook. Evaluates before the call connects, so zero marginal cost.
- **MMS** — Telnyx accepts `media_urls` on the SMS send call. One extra schema field.
- **CDR Reporting Endpoints** — Aggregate queries on the existing `call_events` table (total calls, avg duration, success rate). PostgreSQL window functions, no new infra.
- **Call Transfer (blind/attended)** — Jambonz has a `redirect` verb. New endpoint + minor Jambonz provider method.

### Medium effort — 1–2 weeks each

New models, more logic, or third-party integration required.

- **Voicemail** — Jambonz records to S3 (already wired). Needs: `voicemail_boxes` table, greeting audio management, MWI via SIP NOTIFY, optional email delivery (SendGrid). Scalability: S3 ~$0.023/GB — 1,000 hours of audio ≈ $1.50.
- **IVR** — Jambonz `gather` + `say`/`play` verbs make this a webhook handler problem. Needs: JSON menu config per customer, a webhook that routes DTMF presses. Zero marginal cost per call.
- **Number Porting** — Telnyx LOA porting API. Needs: `porting_requests` table, status polling ARQ job, UI form.
- **Mass Notifications** — ARQ worker already running. Add bulk-SMS and bulk-voicemail-drop tasks with templating and throttle via existing rate limits.
- **Call Parking** — FreeSWITCH/Jambonz support park slots natively. Needs: parking slot model, `park`/`retrieve` endpoints, real-time slot status via Redis.
- **Grafana Call Dashboards** — Add Prometheus counters per call status + a Grafana dashboard JSON. No new services.

### High effort — 3–6 weeks each

New architectural components or significant protocol work required.

- **Call Queues + Hold Music** — Jambonz has a queue concept. Needs: queue model, agent assignment, wait-time estimation, hold music management, supervisor UI. FreeSWITCH scales to hundreds of concurrent queued calls per core; cost stays at infra + Telnyx minutes.
- **Monitor / Whisper / Barge-in** — FreeSWITCH supports `eavesdrop` and three-way conference. Needs: supervisor auth scope, real-time active-call registry (Redis HSET per call SID), WebSocket push to UI.
- **Presence / BLF** — Needs a SIP SUBSCRIBE/NOTIFY server or WebSocket presence bus. Redis pub/sub can power a WebSocket feed. Hard part is SIP registration state tracking (Jambonz emits events but they must be consumed).
- **IP Fax (T.38 / Virtual Fax)** — Telnyx supports T.38 SIP trunks. Needs: fax gateway (HylaFAX or Fax.Plus API), PDF↔TIFF conversion, `fax_jobs` table, S3 storage. HIPAA: add S3 SSE-KMS. Marginal cost: Telnyx fax page rates (~$0.007/page) + S3.

### Very high effort / separate product — 6+ weeks

- **Softphone App (iOS/Android)** — First provision real Jambonz SIP credentials and deliver each secret once; those standard credentials can then work with Zoiper/Linphone/Bria. A branded native app is a separate project.
- **Team Messaging** — Entirely different product. Most practical path: self-hosted Matrix/Element bridged to Carameli's customer identity.
- **Contact Sync (Microsoft 365)** — OAuth app registration, Microsoft Graph API, contact mapping, Microsoft partner/app certification required.

---

## Scalability & Cost Notes

Because the call engine (Jambonz + FreeSWITCH) is self-hosted and the carrier (Telnyx) is wholesale-priced, per-call cost stays very low at any volume.

| Cost Driver | Scale Model |
|---|---|
| Inbound/outbound minutes | Telnyx wholesale ~$0.004–0.008/min, linear |
| SMS | Telnyx ~$0.004–0.008/message |
| Fax pages | Telnyx ~$0.007/page |
| Concurrent calls | FreeSWITCH: hundreds of concurrent calls per core; add replicas horizontally |
| Voicemail/recording storage | S3 ~$0.023/GB |
| IVR, queuing, call control logic | Zero marginal cost — runs inside the existing FreeSWITCH container |
| Database | PostgreSQL handles millions of CDR rows; add read replicas if needed |

Features like IVR, call queuing, call parking, and voicemail add **zero additional per-call cost** — they are compute inside FreeSWITCH, which is already running.
