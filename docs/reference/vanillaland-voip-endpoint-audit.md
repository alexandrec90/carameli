# VanillaLand VoIP endpoint audit

Audited 2026-08-16 against Carameli `master` and the VanillaLand working tree on
`feature/alex-testing-cloudli`.

## Result

VanillaLand's provider-neutral `IVoipService` is the useful compatibility boundary. It
contains 28 members across provisioning, messaging, call control, directory/HUD,
recordings, and account management. Counting the duplicate
`DeletePhoneOrExtension` overload as one behavior leaves 27 operations.

Carameli already has most of the HTTP surface. The remaining work is not a list of
missing route names:

- **Two provider workflows are absent:** branch assignment and bulk recording archives.
- **Three legacy contracts need new behavior or data:** per-call SCI preparation,
  voicemail-drop code resolution, and SIP account-extension credentials.
- **Several routes exist but the VanillaLand `CarameliService` still throws:** customer
  and line reads, pointers, auto-attendant, SCI, voicemail drop, and HUD/account data.
- **Clarity agent state is partially replaced:** Carameli polls Jambonz calls and SIP
  registrations, but does not reproduce Cloudli's user-managed presence fields.

Adding aliases for the five real gaps would be misleading. The current request and
response shapes cannot preserve the legacy behavior without the workflow/model work
listed below.

## Provider contract parity

### Implemented and wired through `CarameliService`

| VanillaLand behavior | Carameli surface | Notes |
| --- | --- | --- |
| Create an extension range | `POST /api/v1/extensions/bulk` | Atomic; replaces Cloudli's one-at-a-time create loop. |
| Find available extensions | `GET /api/v1/extensions` | The adapter derives unused numbers over the requested range. |
| Deactivate extension | `PATCH /api/v1/extensions/{id}` | Soft delete, as required by Carameli's data policy. |
| Create/deactivate a DID | `POST /api/v1/phone-lines`; `PATCH /api/v1/phone-lines/{id}` | Carrier purchase/release is preserved. |
| Count phone lines | `GET /api/v1/phone-lines` | The adapter counts returned rows. |
| Toggle SMS and recording | `PATCH /api/v1/phone-lines/{id}` | Replaces four legacy RPC verbs. |
| Send SMS | `POST /vsapi/1.0.0/VsMessaging/Sms/Send/{customerId}` | Telnyx-backed. |
| List area codes | `GET /vsapi/1.0.0/GetAreaCodes[/country/state]` | Includes toll-free and international searches. |
| Create a customer account | `POST /vsapi/1.0.0/VsCustomer/Create` | Creates Carameli's tenant boundary; Telnyx/Jambonz have no per-customer sub-account here. |
| Callback by extension | `POST /vsapi/1.0.0/Callback/ByExtension` | Jambonz-backed two-leg callback. |
| Vendor account identifier | VanillaLand `tblVoipAccountMapping` | Correctly remains adapter-side; Carameli uses UUIDs. |

### Server capability exists, VanillaLand adapter is not wired

| VanillaLand behavior | Existing Carameli surface | Adapter state |
| --- | --- | --- |
| Get customer | `GET /vsapi/1.0.0/VsCustomer/Get/{customerId}` | `CarameliService.GetCustomer` throws. |
| Get customer phone lines | `GET /vsapi/1.0.0/VsCustomer/GetPhoneLines/{customerId}` | `CarameliService.GetCustomerPhoneLines` throws. |
| Get one phone line | `GET /vsapi/1.0.0/PhoneLine/Get/{customerId}/{phoneNumber}` | `CarameliService.GetPhoneLineInfo` throws. |
| Enable a simple auto-attendant | Create a line, then `PUT /vsapi/1.0.0/PhoneLine/SetAutoAttendant` | `AddAutoAttendant` can be composed but currently throws. |
| Read agent call/registration state | `GET /vsapi/1.0.0/AgentStatus/{customerId}` | The Clarity/HUD path does not consult Carameli. |

Pointers are only partly composable. `AddPointerToExtension` in Cloudli provisions a DID
from an area code and attaches it to an extension. Carameli currently requires the DID to
already exist at `POST /AddPointerToExtension`. Cloudli's delete accepts only a phone
number; Carameli's `DELETE /DeletePointerToExtension` also requires the extension. The
adapter therefore needs orchestration plus a lookup, not a direct route rename.

### Missing behavior or data

| Gap | Legacy contract | Why the current Carameli route/model is not equivalent |
| --- | --- | --- |
| Branch assignment | `PUT Branch/Assign` with provider account id, branch id, and number/extension | No branch model or provider operation exists. VanillaSoft calls it immediately after provisioning for departments mapped to a CMV/Cloudli branch. |
| Bulk recording archive | `POST VsArchive` with export id, archive name, and URL/filename entries | Carameli exports one recording URL at a time. There is no archive job, ZIP artifact, completion state, or safe policy for fetching caller-supplied URLs. |
| Per-call SCI preparation | `POST Precall/Add` with `fromExtension`, destination, contact id, and candidate area codes | Carameli's `/PostSCIbyZipCode` stores a standing extension rule for one 3/5-digit ZIP. It does not hold per-call context or select the outbound caller ID. |
| Voicemail-drop code resolution | `POST VsMessageDrop?vscustomerId=...&extension=...&msgDropNumber={voiceDropCode}` | Carameli requires destination E.164 plus a resolved `audio_url`. It has no mapping from VanillaSoft's integer drop code to an audio asset. |
| Account extensions / SIP credentials | `POST AccessCheck/AccountData` returns name, extension, SIP username, password, and domain | Carameli lists extensions and SIP usernames, but does not store a retrievable SIP password, user name, or usable SIP domain. Returning blank values would break the softphone setup flow. |

The last gap is larger than an endpoint. `POST /api/v1/extensions` currently creates a
database row without provisioning a Jambonz SIP credential. A compatible AccountData
response must follow actual SIP credential provisioning and a one-time secret-delivery
design; passwords must not be added to ordinary list responses.

## Clarity and public API findings

`VanillaSoft.Backend/CMVClarity/CMVClarityAPI.cs` makes two relevant calls:

- Cloudli auth (`POST /auth`) is provider-specific and should not be cloned. Carameli uses
  its existing static Bearer token boundary.
- HUD Phones (`GET HUD/Phones?accountID=...`) is functionally replaced by the Jambonz-backed
  agent-status poller and `GET /AgentStatus/{customerId}`. Carameli provides call state and
  SIP registration, but not Cloudli's `presence`, `idle`, `isSelf`, or display-name fields.
  The legacy DeviceData call is already disabled in VanillaLand because that Cloudli
  endpoint does not exist.

`VanillaSoft.PubApi` is not a second telephony provider contract:

- `contacts/{contactId}/callHistory`, `GetCallHistory`, and `AddCallHistory` are CRM APIs
  scoped by VanillaSoft contacts, projects, users, and result codes. Carameli should keep
  sending provider call events back to VanillaSoft; it should not acquire a duplicate CRM
  contact/project model to host these routes.
- `irFilters/{projectId}` manages Intellective Routing filters over CRM lead criteria.
  Despite the word "routing", it is lead distribution, not SIP/call routing or SCI.
- The remaining PubApi controllers are contacts, custom tables, search, users, key
  verification, and HM export controls. They are outside Carameli's telephony boundary.

## The three-bucket hypothesis

The claim that every VanillaLand API call is Autoklose, HERE, or VoIP is false. The sweep
also found these independent integrations:

- VanillaSoft's own SOAP/REST services and generated connected-service clients;
- Microsoft Graph and Google identity/calendar APIs;
- Salesforce, NetSuite, Gong, ChurnZero, and other CRM/revenue integrations;
- payment gateways including Authorize.Net, CyberSource, Flo2Cash, and Paystation;
- Gryphon DNC/compliance services;
- MaxMind geolocation/database downloads.

This distinction matters most in `VanillaSoft.CloudliApi`: the project is a VanillaSoft web
application with a generated client back into VanillaSoft's broad CRM service. Those calls
are not Cloudli carrier operations. The actual provider contract is concentrated in
`VanillaSoft.Backend/Cloudli/CloudliClient.cs`, the `IVoipService` capability interfaces,
`VanillaSoft.Backend/ConnectMeVoice/`, and `VanillaSoft.Backend/CMVClarity/`.

## Sources used for the sweep

- `AppCode/VanillaSoft.Backend/Cloudli/Interfaces/IVoipCapabilities.cs`
- `AppCode/VanillaSoft.Backend/Cloudli/CloudliClient.cs`
- `AppCode/VanillaSoft.Backend/Carameli/CarameliClient.cs`
- `AppCode/VanillaSoft.Backend/Carameli/CarameliService.cs`
- `AppCode/VanillaSoft.Backend/ConnectMeVoice/CmvClientHelper.cs`
- `AppCode/VanillaSoft.Backend/ConnectMeVoice/ExportRecordings.cs`
- `AppCode/VanillaSoft.Backend/CMVClarity/CMVClarityAPI.cs`
- `AppCode/VanillaSoft.PubApi/Controllers/CallHistoryController.cs`
- `AppCode/VanillaSoft.PubApi/Controllers/IRFilterController.cs`
- `AppCode/Vanillasoft.Webservice/VanillaSoftWS_Voip.cs`
