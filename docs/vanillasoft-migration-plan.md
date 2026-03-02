# VanillaSoft: Replace Cloudli with Carameli (VoiceGateway)

<!-- markdownlint-disable MD024 MD036 MD040 MD060 -->

**Target audience:** AI coding agent working on the VanillaSoft CRM codebase.

This document tells you exactly what to change, where to look, and what the replacement
API looks like. Carameli is a self-hosted VoIP microservice that exposes the same
logical operations as Cloudli (phone line provisioning, extensions, SMS, voicemail drop,
call tracking) via a REST API with Bearer token authentication.

---

## 1. Orientation

| Aspect | Cloudli | Carameli (replacement) |
| --- | --- | --- |
| Type | Third-party SaaS VoIP | Self-hosted FastAPI microservice |
| Auth | (check existing code) | `Authorization: Bearer <api_key>` |
| Base URL config key | (check existing code) | `CARAMELI_BASE_URL` (you will add this) |
| Customer identity | (check existing code) | `vs_customer_id` (integer, same as VanillaSoft customer ID) |
| Per-customer credential | (check existing code) | Per-customer `api_key` stored in Carameli DB, provided at customer creation |

---

## 2. Search Strategy — Find All Cloudli References

Run these searches in the VanillaSoft codebase before touching anything:

```
# Find every file that references Cloudli
grep -ri "cloudli" . --include="*.cs" --include="*.js" --include="*.ts" \
  --include="*.py" --include="*.json" --include="*.yaml" --include="*.yml" \
  --include="*.config" --include="*.env*" -l

# Find HTTP client / base URL config
grep -ri "cloudli" . -l
grep -ri "voip" . -l
grep -ri "vsapi" . -l
grep -ri "PhoneLine" . -l
grep -ri "VsExtension" . -l
grep -ri "VsMessaging" . -l
grep -ri "VsMessageDrop" . -l
grep -ri "PostSCIbyZipCode" . -l
grep -ri "GetAreaCodes" . -l
```

Likely locations to check:

- Environment / config files (`.env`, `appsettings.json`, `config.yaml`)
- HTTP client service class (e.g., `CloudliClient.cs`, `VoipService.js`, `cloudli.py`)
- Any service-registration / dependency-injection wiring
- Any place that constructs phone numbers, extension lists, or SMS requests

---

## 3. Configuration Changes

### 3a. Base URL

Remove any existing `CLOUDLI_BASE_URL` / `CLOUDLI_API_URL` config key and replace with:

```
CARAMELI_BASE_URL=https://<your-carameli-host>   # no trailing slash
```

In development this will be `http://localhost:8000` if Carameli runs locally.

### 3b. Authentication

Carameli uses a single shared Bearer token for the VanillaSoft→Carameli service call:

```
CARAMELI_API_KEY=<the bearer token configured in Carameli's API_KEY_SECRET env var>
```

Every HTTP request to Carameli must include:

```
Authorization: Bearer <CARAMELI_API_KEY>
Content-Type: application/json
```

### 3c. Per-Customer Credentials

Each VanillaSoft customer/account that uses telephony must have a corresponding Carameli
customer record. That record stores the customer's Twilio credentials. When you create a
customer in Carameli you supply their `vs_customer_id` (the VanillaSoft integer ID) and
Twilio creds. After that, all subsequent calls to Carameli identify the customer by
their `vs_customer_id` — no need to pass Twilio credentials on every request.

---

## 4. Complete API Reference

All endpoints are prefixed with `/vsapi/1.0.0/`. All require
`Authorization: Bearer <token>` unless marked *(no auth)*.

### 4.1 Customer Management

#### Create customer

```
POST /vsapi/1.0.0/VsCustomer/Create
Content-Type: application/json

{
  "vs_customer_id": 12345,          // VanillaSoft integer customer ID
  "api_key": "cust-secret-key",     // arbitrary bearer key for this customer (you choose)
  "twilio_account_sid": "ACxxx",
  "twilio_auth_token": "xxx"
}

→ 200
{
  "id": "uuid",
  "vs_customer_id": 12345,
  "api_key": "cust-secret-key",
  "twilio_account_sid": "ACxxx",
  "active": true,
  "created_at": "2026-01-01T00:00:00Z"
}
```

#### Get customer

```
GET /vsapi/1.0.0/VsCustomer/Get/{vs_customer_id}

→ 200  CustomerResponse (same shape as above)
→ 404  { "detail": "Customer not found" }
```

#### Get internal UUID from vs_customer_id

```
GET /vsapi/1.0.0/VsCustomer/GetCustid/{vs_customer_id}

→ 200  { "internal_id": "uuid", "vs_customer_id": 12345 }
```

#### Get all active phone lines for customer

```
GET /vsapi/1.0.0/VsCustomer/GetPhoneLines/{vs_customer_id}

→ 200  [ PhoneLineResponse, ... ]   (see §4.2 for shape)
```

---

### 4.2 Phone Lines (DIDs)

#### Add (purchase) a DID

```
POST /vsapi/1.0.0/PhoneLine/Add
Content-Type: application/json

// Option A — by area code:
{ "vs_customer_id": 12345, "area_code": "415" }

// Option B — specific number:
{ "vs_customer_id": 12345, "phone_number": "+14155550100" }

→ 200
{
  "id": "uuid",
  "customer_id": "uuid",
  "phone_number": "+14155550100",
  "twilio_sid": "PNxxx",
  "sms_enabled": false,
  "recording_enabled": false,
  "active": true,
  "created_at": "2026-01-01T00:00:00Z"
}
```

#### Get a specific DID

```
GET /vsapi/1.0.0/PhoneLine/Get/{vs_customer_id}/{phone_number}

→ 200  PhoneLineResponse
→ 404  { "detail": "Phone line not found" }
```

#### Get count of active DIDs

```
GET /vsapi/1.0.0/PhoneLine/GetCount/{vs_customer_id}

→ 200  { "count": 5, "vs_customer_id": 12345 }
```

#### Deactivate (release) a DID

```
PUT /vsapi/1.0.0/PhoneLine/Deactivate
Content-Type: application/json

{ "vs_customer_id": 12345, "phone_number": "+14155550100" }

→ 200  PhoneLineResponse  (active: false)
```

#### Toggle call recording on a DID

```
PUT /vsapi/1.0.0/PhoneLine/UpdateCallRecording
Content-Type: application/json

{ "vs_customer_id": 12345, "phone_number": "+14155550100", "enabled": true }

→ 200  PhoneLineResponse
```

---

### 4.3 Extensions (SIP)

#### Add extension

```
POST /vsapi/1.0.0/VsExtension/Add
Content-Type: application/json

{
  "vs_customer_id": 12345,
  "extension_number": "101",
  "password": "optional-custom-pw"   // omit to auto-generate
}

→ 200
{
  "id": "uuid",
  "customer_id": "uuid",
  "extension_number": "101",
  "sip_username": "ext101_abcd1234",
  "sip_credential_sid": "CRxxx",
  "twilio_domain_sid": "SDxxx",
  "active": true,
  "created_at": "2026-01-01T00:00:00Z"
}
```

#### Get available extension numbers in a range

```
GET /vsapi/1.0.0/VsExtension/GetAvailable/{vs_customer_id}/{start_ext}/{end_ext}

→ 200  { "available": ["102", "103", "105"], "vs_customer_id": 12345 }
```

#### Deactivate extension

```
PUT /vsapi/1.0.0/VsExtension/Deactivate/{vs_customer_id}/{extension_number}

→ 200  ExtensionResponse  (active: false)
```

---

### 4.4 SMS

#### Enable SMS on a DID

```
PUT /vsapi/1.0.0/VsMessaging/Sms/Enable/{vs_customer_id}/{phone_number}

→ 200  { "success": true, "phone_number": "+14155550100", "sms_enabled": true }
```

#### Disable SMS on a DID

```
PUT /vsapi/1.0.0/VsMessaging/Sms/Disable/{vs_customer_id}/{phone_number}

→ 200  { "success": true, "phone_number": "+14155550100", "sms_enabled": false }
```

#### Send SMS

```
POST /vsapi/1.0.0/VsMessaging/Sms/Send/{vs_customer_id}
Content-Type: application/json

{
  "from_number": "+14155550100",
  "to_number": "+12125550199",
  "body": "Hello from VanillaSoft"
}

→ 200  { "success": true, "message_sid": "SMxxx" }
→ 400  { "success": false, "detail": "error message" }
```

---

### 4.5 Voicemail Drop

```
POST /vsapi/1.0.0/VsMessageDrop
Content-Type: application/json

{
  "vs_customer_id": 12345,
  "extension": "101",
  "msg_drop_number": "+12125550199",   // number to call
  "audio_url": "https://cdn.example.com/vmessage.mp3"
}

→ 200  { "call_sid": "CAxxx", "status": "initiated" }
```

Carameli uses Twilio AMD (Answering Machine Detection). The audio plays only if an
answering machine is detected.

---

### 4.6 SCI — Selective Call Interception (zip-code routing)

#### Store zip-code routing rule

```
POST /vsapi/1.0.0/PostSCIbyZipCode
Content-Type: application/json

{
  "vs_customer_id": 12345,
  "extension_number": "101",
  "zip_code": "94105",
  "enabled": true
}

→ 200  { "success": true }
```

#### Enable / disable all SCI rules for an extension

```
POST /vsapi/1.0.0/UpdateSCIUserOption
Content-Type: application/json

{ "vs_customer_id": 12345, "extension_number": "101", "enabled": false }

→ 200  { "success": true }
```

---

### 4.7 Pointers — DID → Extension mapping

#### Map a DID to an extension (call forwarding)

```
POST /vsapi/1.0.0/AddPointerToExtension
Content-Type: application/json

{ "vs_customer_id": 12345, "phone_number": "+14155550100", "extension_number": "101" }

→ 200  { "success": true }
```

#### Remove a DID → extension mapping

```
DELETE /vsapi/1.0.0/DeletePointerToExtension
Content-Type: application/json

{ "vs_customer_id": 12345, "phone_number": "+14155550100", "extension_number": "101" }

→ 200  { "success": true }
```

---

### 4.8 Area Codes

```
GET /vsapi/1.0.0/GetAreaCodes

→ 200
{
  "area_codes": [
    { "area_code": "212", "state": "NY", "country": "US" },
    ...
  ],
  "count": 312
}

// Filtered:
GET /vsapi/1.0.0/GetAreaCodes/{country}/{state}
// e.g. /GetAreaCodes/US/CA
```

---

### 4.9 Health Check *(no auth)*

```
GET /health

→ 200  { "status": "ok", "service": "VoiceGateway" }
```

---

## 5. Recommended Code Changes

### 5a. Replace or rewrite the Cloudli HTTP client

Locate the class / module that wraps Cloudli HTTP calls. Replace its internals (base URL,
auth header, endpoint paths, request/response shapes) to match §4 above. Keep the same
public method names if other VanillaSoft code calls them — this minimises the blast
radius of the change.

Skeleton (pseudo-code — adapt to whatever language VanillaSoft uses):

```
class CarameliClient:
    base_url = env("CARAMELI_BASE_URL")
    headers  = { "Authorization": f"Bearer {env('CARAMELI_API_KEY')}" }

    def add_phone_line(vs_customer_id, area_code=None, phone_number=None):
        POST /vsapi/1.0.0/PhoneLine/Add  { vs_customer_id, area_code, phone_number }

    def deactivate_phone_line(vs_customer_id, phone_number):
        PUT /vsapi/1.0.0/PhoneLine/Deactivate  { vs_customer_id, phone_number }

    def add_extension(vs_customer_id, extension_number, password=None):
        POST /vsapi/1.0.0/VsExtension/Add  { vs_customer_id, extension_number, password }

    def send_sms(vs_customer_id, from_number, to_number, body):
        POST /vsapi/1.0.0/VsMessaging/Sms/Send/{vs_customer_id}  { from_number, to_number, body }

    def voicemail_drop(vs_customer_id, extension, msg_drop_number, audio_url):
        POST /vsapi/1.0.0/VsMessageDrop  { vs_customer_id, extension, msg_drop_number, audio_url }

    def get_area_codes(country="US", state=None):
        GET /vsapi/1.0.0/GetAreaCodes  (or /GetAreaCodes/{country}/{state})

    # ... etc. for every operation used by VanillaSoft
```

### 5b. Customer provisioning flow

When VanillaSoft provisions a new telephony customer, call:

```
POST /vsapi/1.0.0/VsCustomer/Create
{
  "vs_customer_id": <vanillasoft_customer_id>,
  "api_key":        <a strong random secret you generate>,
  "twilio_account_sid": <customer's Twilio SID>,
  "twilio_auth_token":  <customer's Twilio token>
}
```

Store the returned `id` (UUID) if you ever need to reference the Carameli record directly,
though `vs_customer_id` is sufficient for all subsequent calls.

### 5c. Remove / replace Cloudli-specific concepts

| Cloudli concept | Carameli equivalent |
| --- | --- |
| Cloudli account / org ID | `vs_customer_id` (same integer VanillaSoft already has) |
| Cloudli DID object | `PhoneLineResponse` (see §4.2) |
| Cloudli agent / user | `ExtensionResponse` (SIP credential, see §4.3) |
| Cloudli SMS channel | Enable SMS on a DID (see §4.4) |
| Cloudli voicemail drop | `POST /VsMessageDrop` (see §4.5) |
| Cloudli routing rule | SCI zip-code rule + pointer (see §4.6–4.7) |
| Cloudli webhook / CDR | Carameli calls Twilio webhooks internally; call events stored in its own DB |

### 5d. Error handling

All Carameli endpoints return standard HTTP status codes:

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 400 | Bad request (validation error) — body contains `{ "detail": "..." }` |
| 401 | Missing or invalid Bearer token |
| 404 | Resource not found — body contains `{ "detail": "..." }` |
| 500 | Internal server error (Twilio failure, DB error) |

---

## 6. Testing Checklist

After migration, verify each operation end-to-end:

- [ ] Customer creation (`POST /VsCustomer/Create`) returns 200
- [ ] DID purchase by area code (`POST /PhoneLine/Add`) returns a real phone number
- [ ] DID deactivation releases the number in Twilio
- [ ] Extension creation returns valid SIP credentials
- [ ] SMS enable → send → disable round trip works
- [ ] Voicemail drop initiates a call (check Twilio console)
- [ ] Area code list returns non-empty result
- [ ] Health check (`GET /health`) returns `{ "status": "ok" }`
- [ ] Auth rejected when Bearer token is wrong (expect 401)
- [ ] 404 returned when customer does not exist

---

## 7. Environment Variables to Add / Change

```dotenv
# Remove:
CLOUDLI_BASE_URL=...
CLOUDLI_API_KEY=...
CLOUDLI_*=...          # any other Cloudli-specific keys

# Add:
CARAMELI_BASE_URL=https://<carameli-host>
CARAMELI_API_KEY=<the API_KEY_SECRET value from Carameli's .env>
```

---

## 8. Notes on Feature Parity

- **Inbound call routing** — Carameli stores SCI rules and DID→extension pointers but the
  full inbound TwiML routing logic is still being completed (see Carameli readiness plan).
  Outbound calling and voicemail drop are fully operational.

- **Call records** — Carameli persists call events internally. If VanillaSoft previously
  polled Cloudli for CDRs, that polling should be removed; Carameli will write call data
  back to VanillaSoft once the write-back integration is built (see Carameli readiness plan).

- **Recording URLs** — Carameli records the Twilio recording URL in its database. A
  separate endpoint to retrieve recording URLs can be added on request.
