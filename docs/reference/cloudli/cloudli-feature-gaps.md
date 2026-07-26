# Cloudli Feature Gap Analysis

Comparison of Cloudli's advertised features against Carameli's current implementation.
Use this as a backlog reference — features are grouped by effort, not priority.

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Implemented |
| ⚠️ | Partial |
| ❌ | Missing |

---

## Feature Status

### Core Infrastructure

| Feature | Status | Notes |
|---|---|---|
| Hosted IP Telephony | ✅ | Jambonz + FreeSWITCH |
| Admin Portal (Web) | ⚠️ | 3D UI exists for Lines/Extensions only |
| HD Voice Quality | ✅ | FreeSWITCH handles codec negotiation |
| IVR (press 1 for Sales…) | ❌ | |
| Customer Account Provisioning | ❌ | CMV `VsCustomer/Add` creates a VoIP sub-account per VanillaSoft customer; Carameli has customer-scoped auth but no account lifecycle endpoint |
| Branch / Sub-group Assignment | ❌ | CMV `Branch/Assign` links extensions to organizational branches; no equivalent in Carameli |
| REST API | ✅ | FastAPI |

### Call Management

| Feature | Status | Notes |
|---|---|---|
| Call Routing / Forwarding | ⚠️ | DID→extension pointers exist; no time-based/conditional routing |
| Callback / Click-to-Call | ❌ | CMV exposed `Callback/ByExtension/{cid}/{ext}/{dst}`; Jambonz `dial` verb can bridge the two legs — needs a `POST /calls/callback` endpoint |
| Enhanced Voicemail | ❌ | No mailbox, greetings, or email/SMS delivery |
| Call Queues + Hold Music | ❌ | |
| Call Parking | ❌ | |
| Presence / BLF | ⚠️ | VanillaLand polls `clarityucaas.com` HUD Phones + Device Status endpoints every 30 s via `CMVAgentStatus` Windows service and caches per-agent call state; Carameli has no equivalent poller or agent-status endpoint |
| Call Screening / Blacklist | ❌ | SCI zip-code filter exists but is not the same thing |

### Mobile & Desktop Apps

| Feature | Status | Notes |
|---|---|---|
| Softphone (iOS/Android/Desktop) | ❌ | SIP creds exist — compatible softphones (Zoiper, Linphone) could use them today |
| Business SMS | ✅ | Send/receive via Telnyx |
| SMS Delivery Receipts | ❌ | Cloudli pushes delivery receipt webhooks (`notify/IncomingSmsMessageDeliveryReceipt`); Carameli has no handler and no per-message delivery-status field |
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
| IR Filter Management (Clarity API) | ❌ | Clarity API (`VanillaSoft.PubApi`) exposes CRUD for Intellective Routing filters (get, copy, assign, update); no Carameli equivalent |

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
| Local + Toll-Free Numbers | ⚠️ | Local works; toll-free not wired up |
| International Numbers | ⚠️ | Telnyx covers 180+ countries; area code lookup doesn't expose them |
| Number Porting | ❌ | Telnyx supports LOA porting via API |

---

## Implementation Effort

### Low effort — 1–3 days each

Thin API wrappers over capabilities already in the stack.

- **Call Screening / Blacklist** — `blocked_numbers` table + webhook intercept in the Jambonz call hook. Evaluates before the call connects, so zero marginal cost.
- **International Numbers** — Telnyx already handles them. Extend `get_available_area_codes` to accept non-US country codes.
- **Toll-Free Numbers** — Telnyx search filter change (`number_type=toll-free`). One extra parameter.
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

- **Softphone App (iOS/Android)** — SIP credentials Carameli generates today are compatible with any standard SIP client. Pointing users at Zoiper/Linphone/Bria is free and immediate. A branded native app is a separate project.
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
