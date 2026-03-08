# PRD: Carameli — Homemade VoIP Service to Replace Cloudli/CMV

## Context

VanillaSoft currently uses two VoIP providers: **Cloudli** and **CMV (ConnectMeVoice)**. The `CloudliService.cs` routes calls to either provider based on a per-customer setting. Both providers offer similar capabilities:

- Phone number (DID) provisioning and management
- SIP extension management
- SMS send/enable/disable
- Call recording toggle per line
- Voicemail drop
- Selective Call Interception (SCI) routing by zip code
- Call tracking (talk time, call attempts) fed into VanillaSoft's database

The goal is to replace both providers with a single, self-hosted microservice (**Carameli**) built on top of **Twilio**, which exposes the same REST contract that VanillaSoft's backend already calls — requiring only a config URL change in VanillaSoft, not a new C# client.

---

## Recommended Tech Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | **Python 3.12** | Excellent Twilio SDK, fast to write, easy to maintain |
| Web framework | **FastAPI** | Async, auto OpenAPI docs, Pydantic validation |
| Background tasks | **APScheduler** (in-process) | Replaces CMV Call Data Service polling; no separate worker process needed |
| Database | **PostgreSQL 18** | Stores customers, DIDs, extensions, call records |
| ORM | **SQLAlchemy 2 + Alembic** | Migrations, async-compatible |
| VoIP provider | **Twilio** | Best SDK/docs, full feature parity, programmable webhooks |
| Media storage | **S3-compatible blob** (or local disk for dev) | Call recordings and voicemail audio files |
| Container | **Docker + Docker Compose** | Single-command deployment |
| Auth | **API key (header)** | Matches Cloudli's auth model; add OAuth later if needed |

---

## Architecture Overview

```text
VanillaSoft Backend (.NET)
  │
  │  HTTP REST (same Cloudli API contract)
  ▼
┌────────────────────────────────┐
│         Carameli           │
│   FastAPI  +  APScheduler      │
│                                │
│  /vsapi/1.0.0/...  ← routes   │
│  /webhooks/twilio/...          │
│                                │
│  TwilioProvider (SDK wrapper)  │
│  CustomerRepo, LineRepo, etc.  │
│  CallSyncJob (talk time/       │
│    call attempt polling)       │
└────────────┬───────────────────┘
             │  Twilio REST API
             ▼
         Twilio Platform
             │  Webhooks (status callbacks)
             └─────────────────────────────┐
                                           ▼
                              Carameli /webhooks/...
                                           │
                                           ▼
                                     PostgreSQL DB
                                           │
                        (optional direct write or expose query API)
                                           ▼
                               VanillaSoft SQL Server
```

---

## API Contract (Drop-in Replacement)

Carameli mounts all routes under `/vsapi/1.0.0/` to match the existing `CloudliApiBaseUrl` config. Only `Web.config` / `App.config` base URL values need to change.

### Authentication

Each request must include header:

```text
Authorization: Bearer <api_key>
```

Carameli validates this key against its own customer table.

---

### Phone Lines (DIDs)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/PhoneLine/Add` | Purchase a new DID from Twilio and register it |
| GET | `/PhoneLine/Get/{customerId}/{phoneNumber}` | Get line info |
| GET | `/PhoneLine/GetCount/{customerId}` | Count of active lines for customer |
| PUT | `/PhoneLine/Deactivate` | Release the DID from Twilio |
| PUT | `/PhoneLine/UpdateCallRecording` | Toggle Twilio call recording on the DID |

**Twilio mapping:**

- `Add` → `client.incoming_phone_numbers.create(phone_number=..., voice_url=..., sms_url=...)`
- `Deactivate` → `client.incoming_phone_numbers(sid).delete()`
- `UpdateCallRecording` → Update TwiML app or set `record=True` on the number's voice URL

---

### Extensions (SIP)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/VsExtension/Add` | Create a SIP credential for the extension |
| GET | `/VsExtension/GetAvailable/{customerId}/{startExt}/{endExt}` | List free extension numbers in range |
| PUT | `/VsExtension/Deactivate/{customerId}/{extension}` | Delete the SIP credential |

**Twilio mapping:**

- Extensions are modeled as **Twilio SIP Credentials** (`client.sip.credential_lists(sid).credentials.create(username=ext, password=...)`)
- Each customer gets a **SIP Credential List** + **SIP Domain** (`{customerId}.sip.twilio.com`)
- Calls to an extension route via TwiML `<Dial><Sip>` verb

---

### SMS

| Method | Path | Description |
| --- | --- | --- |
| PUT | `/VsMessaging/Sms/Enable/{customerId}/{smsPhoneNumber}` | Enable SMS on a DID (attach webhook) |
| PUT | `/VsMessaging/Sms/Disable/{customerId}/{smsPhoneNumber}` | Disable SMS (remove webhook) |
| POST | `/VsMessaging/Sms/Send/{customerId}` | Send an SMS via Twilio Messaging |

**Twilio mapping:**

- Enable/Disable → update the number's `sms_url` (set or clear the webhook)
- Send → `client.messages.create(to=..., from_=..., body=...)`

---

### Customer

| Method | Path | Description |
| --- | --- | --- |
| GET | `/VsCustomer/Get/{customerId}` | Return stored customer info |
| GET | `/VsCustomer/GetCustid/{customerId}` | Return Carameli's internal customer ID |
| GET | `/VsCustomer/GetPhoneLines/{customerId}` | Return all DIDs for the customer |

These are served from Carameli's own PostgreSQL database (no Twilio call needed for reads).

---

### Voice Mail Drop

| Method | Path | Description |
| --- | --- | --- |
| POST | `/VsMessageDrop` | Initiate a call, detect answering machine, play audio |

Query params: `vscustomerId`, `extension`, `msgDropNumber`

**Twilio mapping:**

- `client.calls.create(to=target, from_=did, machine_detection='Enable', twiml=...)`
- On `AnsweredBy=machine_start` webhook, play the pre-recorded audio file via TwiML `<Play>`

---

### Selective Call Interception (SCI)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/PostSCIbyZipCode` | Store zip-code routing rules in DB |
| POST | `/UpdateSCIUserOption` | Enable/disable SCI for an extension |

**Implementation:**

- SCI rules stored in Carameli's PostgreSQL database
- On inbound call webhook, look up zip code of caller (via reverse-geocoding or stored DID geography), then route call via TwiML `<Dial><Number>` to the assigned agent extension

---

### Pointers (DID → Extension forwarding)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/AddPointerToExtension` | Store DID→extension mapping and update TwiML routing |
| DELETE | `/DeletePointerToExtension` | Remove DID→extension mapping |

Implemented as a DB table + dynamic TwiML generator called by Twilio webhook.

---

### Area Codes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/GetAreaCodes` | Return all area codes (cached from Twilio `available_phone_numbers` API) |
| GET | `/GetAreaCodes/{country}/{state}` | Filter by country/state |

**Twilio mapping:** `client.available_phone_numbers('US').local.list(area_code=...)`

---

## Call Tracking (Replacing CMV Call Data Service)

The current Windows service polls the database every 30 seconds / 1 second looking for unmatched call records.

**Carameli replaces this with Twilio webhooks:**

1. Twilio fires `statusCallback` with `CallStatus`, `Duration`, `RecordingUrl` when a call ends
2. Carameli's `/webhooks/twilio/call-status` handler:

   - Stores the raw event in `carameli.call_events` PostgreSQL table
   - Calls VanillaSoft's internal API (or writes directly to `tblCMVCallNotification` / `tblCMVTalkTime`) to insert the call record
   - Matching logic (outbound vs inbound, time padding) is ported from `CMVCallData.cs` into a Python function

**APScheduler fallback job:**

- Runs every 30 seconds
- Queries for any call events that failed to post and retries
- Equivalent to the current service's `LoopPauseInterval`

---

## Data Model (PostgreSQL)

```text
customers
  id (uuid), vs_customer_id (int), api_key (string), twilio_account_sid, twilio_auth_token
  created_at, active

phone_lines
  id (uuid), customer_id (fk), phone_number (e164), twilio_sid
  sms_enabled (bool), recording_enabled (bool), active

extensions
  id (uuid), customer_id (fk), extension_number (string)
  sip_username, sip_credential_sid, twilio_domain_sid, active

sci_rules
  id (uuid), customer_id (fk), extension_id (fk), zip_code, enabled

did_pointers
  id (uuid), phone_line_id (fk), extension_id (fk)

call_events
  id (uuid), customer_id (fk), twilio_call_sid (string)
  direction (inbound/outbound), from_number, to_number, extension
  started_at, answered_at, ended_at, duration_seconds, ring_seconds
  recording_url, status, vs_call_history_id (nullable), matched_at
```

---

## Integration with VanillaSoft (Migration Steps)

1. **Deploy Carameli** (Docker Compose, single server or Azure App Service)
2. **Provision Twilio sub-accounts** per customer (or use one account with tags)
3. **Migrate phone numbers** from Cloudli/CMV to Twilio (port or repurchase)
4. **Change one config value** per deployed VanillaSoft component:

   - `Web.config`, `App.config`: `CloudliApiBaseUrl` → `https://your-carameli-host/vsapi/1.0.0/`

5. **Update CloudliService.cs** to remove the CMV/Cloudli conditional routing — both providers now point to Carameli (or keep the existing routing; Carameli handles both paths)
6. **Retire** the old `CMV Call Data Service` Windows service (Carameli webhooks replace it)

---

## MVP vs Future Scope

### MVP (Phase 1)

- [ ] Customer CRUD + API key auth
- [ ] DID provisioning (add, get, deactivate)
- [ ] SMS enable/disable/send
- [ ] Outbound calling with call recording
- [ ] Call status webhook → write to VanillaSoft DB
- [ ] Talk time / call attempt matching (port from `CMVCallData.cs`)
- [ ] Extension (SIP credential) management
- [ ] Docker deployment

### Phase 2

- [ ] Voicemail drop with AMD (Answering Machine Detection)
- [ ] SCI (Selective Call Interception) with zip code routing
- [ ] DID pointer management
- [ ] Area code search
- [ ] Admin UI (simple Flask/React dashboard)

### Phase 3

- [ ] WebRTC softphone (Twilio Client JS) — replaces physical SIP phones
- [ ] Per-customer Twilio sub-accounts (stronger isolation)
- [ ] Recording storage in S3 with signed URLs
- [ ] Billing/usage reports

---

## Key Files in VanillaSoft to Update

| File | Change Needed |
| --- | --- |
| `AppCode/VanillaSoft.Backend/Cloudli/CloudliClient.cs` | Point base URL to Carameli; or no change if config-driven |
| `AppCode/VanillaSoft.Backend/Cloudli/CloudliService.cs` | Remove CMV vs Cloudli branching; always use new client |
| `AppCode/Vanillasoft.Webservice/Web.config` (line 503) | Update `CloudliApiBaseUrl` |
| `AppCode/VoipLineCountUpdate/App.config` (line 34) | Update `CloudliApiBaseUrl` |
| `AppCode/SMSDripService/App.config` | Update `CloudliApiBaseUrl` |
| `AppCode/NotificationService/App.config` | Update `CloudliApiBaseUrl` |
| `AppCode/SMS Service/App.config` | Update `CloudliApiBaseUrl` |
| `CMV Call Data Service` | Retire (replaced by Carameli webhooks + APScheduler) |

---

## Verification Plan

1. **Local dev:** `docker compose up` — Carameli + Postgres + ngrok tunnel for Twilio webhooks
2. **Unit tests:** pytest for each endpoint with mocked Twilio SDK
3. **Integration tests:** Use Twilio test credentials (no real charges) to exercise DID provisioning, SMS, call status webhooks
4. **VanillaSoft smoke test:** Point a dev VanillaSoft instance at local Carameli; create a phone line, send an SMS, place a test call, verify `tblCallHistory` is updated
5. **Replay production traffic:** Capture real Cloudli webhook payloads, replay them against Carameli, verify matching results are identical to current behavior

---

## Estimated Effort

| Phase | Effort |
| --- | --- |
| Project scaffolding + auth + DB models | 1-2 days |
| DID + SMS + extension endpoints | 2-3 days |
| Twilio webhook handler + call matching port | 2-3 days |
| SCI + voicemail drop | 2-3 days |
| Docker packaging + integration tests | 1-2 days |
| **Total MVP** | **~2 weeks (1 developer)** |
