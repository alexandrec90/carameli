# Carameli Migration — Known Concerns & Shortcomings

These are open issues identified during the Cloudli → Carameli migration that require follow-up work before the integration can be considered complete.

---

## 1. `MessageDrop` — `voiceDropCode` cannot map to `audio_url`

**Affected method:** `ICloudliClient.MessageDrop(int customerId, string voipPhoneNumber, int voiceDropCode)`

**Problem:**
The old Cloudli `VsMessageDrop` endpoint accepted a `msgDropNumber` integer (a code/ID for a pre-recorded voice message) and resolved the audio and destination phone number internally. Carameli's `VsMessageDrop` endpoint requires two explicit fields:

- `msg_drop_number` — the destination phone number to call (string)
- `audio_url` — a public URL to the audio file to play

The current implementation passes `voiceDropCode.ToString()` as `msg_drop_number` and an empty string as `audio_url`. This will not produce a working voicemail drop.

**Required fix:**
1. Determine where VanillaSoft stores voice drop recordings and their associated destination phone numbers (likely a database table keyed by the integer voice drop code).
2. Either:
   - Resolve the `audio_url` and `msg_drop_number` before calling `CloudliClient.MessageDrop` (e.g. in `CloudliService` or the caller), and update the method signature to accept them directly, or
   - Add a repository lookup inside `CloudliService.MessageDrop` to retrieve both values by `voiceDropCode` before delegating to the client.
3. Update `ICloudliClient`, `ICloudliService`, and all callers accordingly.

---

## 2. `CreateAccount` — Carameli requires Twilio credentials not present in `ContactInfoVS`

**Affected method:** `ICloudliClient.CreateAccount(ContactInfoVS contactInfo)`

**Problem:**
The old Cloudli `VsCustomer/Add` endpoint created a Cloudli account from standard contact information (name, address, email, phone). Carameli's `VsCustomer/Create` is a different operation: it provisions a customer in Carameli's database and requires:

- `api_key` — a per-customer bearer key you generate
- `twilio_account_sid` — the customer's Twilio Account SID
- `twilio_auth_token` — the customer's Twilio Auth Token

None of these are present in `ContactInfoVS`. The current implementation throws `NotImplementedException`.

**Required fix:**
1. Identify where VanillaSoft stores each customer's Twilio credentials (SID and token).
2. Create a new method or extend the existing one so that Twilio credentials can be passed alongside the customer ID.
3. Update `ICloudliClient`, `ICloudliService`, `ContactInfoVS` (or introduce a new DTO), and all callers.
4. Decide on the `api_key` generation strategy (e.g. a cryptographically random string stored in VanillaSoft's database for future reference).

---

## 3. `AddAutoAttendant` — No Carameli equivalent

**Affected method:** `ICloudliClient.AddAutoAttendant(int customerId, string areaCode, string countryCode, string stateCode, string timezoneId, int maxDigits)`

**Problem:**
Carameli does not expose an auto-attendant provisioning endpoint. The current implementation throws `NotImplementedException`. Any callers of this method will fail at runtime.

**Required fix:**
Decide on one of:
- Implement auto-attendant configuration directly via the Twilio API from VanillaSoft.
- Disable the auto-attendant feature until Carameli adds support.
- Remove the method from `ICloudliClient` and `ICloudliService` and update all callers to handle the missing capability gracefully.

---

## 4. `AssignExtensionToBranch` — No Carameli equivalent

**Affected method:** `ICloudliClient.AssignExtensionToBranch(int customerId, int? branchId, string phoneNumberOrExtension)`

**Problem:**
Carameli does not have a branch/extension assignment endpoint. The current implementation throws `NotImplementedException`. Any callers of this method will fail at runtime.

**Required fix:**
Decide on one of:
- Manage branch-to-extension assignment entirely within VanillaSoft's own database (without a VoIP provider call).
- Remove the method from the interface and update all callers.

---

## 5. `InitiateCallbackByExtension` — No Carameli equivalent

**Affected method:** `ICloudliClient.InitiateCallbackByExtension(int customerId, string extension, string destinationNumber)`

**Problem:**
Carameli does not expose a callback-by-extension endpoint. The current implementation throws `NotImplementedException`.

**Required fix:**
Decide on one of:
- Implement callback initiation directly via the Twilio API.
- Disable the callback feature until Carameli adds support.
- Remove the method from the interface and update all callers.

---

## 6. `RequestArchive` — No Carameli equivalent

**Affected method:** `ICloudliClient.RequestArchive(int customerId, int exportRequestId, string archiveName, VSAudioFileRequestListEntity[] audioFiles)`

**Problem:**
Carameli does not expose an archive/export endpoint for audio recordings. The current implementation throws `NotImplementedException`. Carameli stores Twilio recording URLs internally; a dedicated retrieval endpoint may be added in a future Carameli release.

**Required fix:**
Decide on one of:
- Fetch recording URLs directly from the Twilio API using the customer's stored credentials.
- Wait for Carameli to expose a recording retrieval endpoint and implement it at that time.
- Disable the recording export feature and communicate the limitation to affected customers.

---

## 7. `PostSCIbyZipCode` — Semantic change: per-call setup vs. persistent routing rules

**Affected method:** `ICloudliClient.PostSCIbyZipCode(int customerId, string fromExt, string toTelephoneNumber, int contactId, IEnumerable<string> areaCodes)`

**Problem:**
The old Cloudli `Precall/Add` endpoint was called once per outbound call to set up real-time area-code routing for that specific call. Carameli's `PostSCIbyZipCode` stores **persistent** routing rules in Carameli's database and is not designed for per-call invocation.

The current migration loops over each area code and stores a persistent rule for it, which is functionally different from the original behaviour. Calling this once per outbound call will create duplicate/redundant rules over time.

Additionally, the original parameter is called `areaCodes` (3-digit strings), while Carameli's field is `zip_code` (typically 5-digit). Whether these represent the same data depends on how the calling code populates the list.

**Required fix:**
1. Clarify whether `areaCodes` in the old code actually contained zip codes or area codes.
2. If these are per-call routing codes, rework the SCI integration so persistent rules are stored once at configuration time (not on every call).
3. Add deduplication or an upsert mechanism if the endpoint may be called repeatedly with the same zip codes.

---

## 8. `AddPointerToExtension` — `areaCode` parameter used as `phone_number`

**Affected method:** `ICloudliClient.AddPointerToExtension(int customerId, string extension, string areaCode, bool enableSMS)`

**Problem:**
The old Cloudli `VsPointer/Add` endpoint accepted an `areacode` parameter (3-digit area code). Carameli's `AddPointerToExtension` endpoint expects a full `phone_number` (e.g. `+14155550100`). The current implementation passes the `areaCode` parameter directly as `phone_number`, which will be incorrect if callers are still passing a 3-digit area code.

**Required fix:**
1. Determine whether callers already pass a full phone number or just an area code.
2. If an area code is passed, either update callers to supply the full DID number, or perform a DID lookup by area code before calling Carameli.
3. Consider renaming the parameter from `areaCode` to `phoneNumber` in the interface to clarify the expected format.

---

## 9. Config values must be filled in before deployment

**Affected files:** All 6 `App.config` / `Web.config` files that were updated.

The placeholder values `https://<carameli-host>/vsapi/1.0.0/` and empty `CarameliApiKey` must be replaced with real values before deploying to any environment.

| Environment | `CarameliApiBaseUrl` | `CarameliApiKey` |
|---|---|---|
| Development | `http://localhost:8000/vsapi/1.0.0/` | value from Carameli's local `.env` (`API_KEY_SECRET`) |
| Staging | `https://<staging-host>/vsapi/1.0.0/` | staging key |
| Production | `https://<prod-host>/vsapi/1.0.0/` | production key |

---

## 10. Call records / CDR polling should be removed

**Background:**
If VanillaSoft previously polled Cloudli for Call Detail Records (CDRs), that polling logic should be identified and removed. Carameli stores call events internally and will write call data back to VanillaSoft once the write-back integration is built (see Carameli readiness plan). Leaving old CDR polling code active may cause errors or stale data.

---

## 11. HUD API Cloudli client not migrated

**Affected path:** `AppCode/VanillaSoft.HudApi/Service/Cloudli/`

The HUD API has its own Cloudli client (`CloudliHudClient.cs`, `ICloudliHudClient.cs`). This was **not** updated as part of this migration and still targets Cloudli. It should be reviewed and migrated separately once the scope of HUD integration with Carameli is defined.
