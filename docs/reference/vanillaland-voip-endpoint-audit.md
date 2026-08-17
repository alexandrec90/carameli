# VanillaLand VoIP endpoint audit

Audited 2026-08-16 against Carameli `master` and the VanillaLand working tree on
`feature/alex-testing-cloudli`.

## Result

VanillaLand's provider-neutral `IVoipService` is the useful compatibility boundary. It
contains 28 members across provisioning, messaging, call control, directory/HUD,
recordings, and account management. Counting the duplicate
`DeletePhoneOrExtension` overload as one behavior leaves 27 operations.

Carameli now has the five workflows that were missing when this audit was written:

- **Branch assignment** persists tenant-scoped CRM metadata on extensions and DIDs.
- **Bulk recording archives** are bounded ARQ jobs over authenticated Carameli recording
  links and configured-bucket S3 objects; arbitrary caller-supplied fetches are rejected.
- **Per-call SCI preparation** selects a customer-owned caller ID and atomically consumes
  the short-lived selection when the corresponding outbound call is created.
- **Voicemail-drop codes** resolve tenant-owned audio assets and inject audio into the
  tenant/extension's tracked active Jambonz call.
- **AccountData** follows real Jambonz SIP-client provisioning and delivers the encrypted
  pending password exactly once. Ordinary extension reads never expose it.

The remaining compatibility work is adapter-side in VanillaLand, not missing Carameli
server behavior:

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

### Implemented compatibility workflows

| Workflow | Legacy contract | Carameli implementation |
| --- | --- | --- |
| Branch assignment | `PUT Branch/Assign` with customer id, nullable branch id, and number/extension | `PUT /vsapi/1.0.0/Branch/Assign`; branch ids remain opaque CRM metadata rather than leaking into the carrier contract. |
| Bulk recording archive | `POST VsArchive` with export id, archive name, and URL/filename entries | `POST /vsapi/1.0.0/VsArchive` plus status `GET`; PostgreSQL state, ARQ/Redis execution, bounded ZIP creation, and S3 output. |
| Per-call SCI preparation | `POST Precall/Add` with `fromExtension`, destination, contact id, and candidate area codes | `POST /vsapi/1.0.0/Precall/Add`; a short-lived row selects an active customer DID and `/VsCall/Initiate` consumes it once after provider success. |
| Voicemail-drop code resolution | `POST VsMessageDrop?vscustomerId=...&extension=...&msgDropNumber={voiceDropCode}` | Audio assets may carry a unique per-customer code from 1–9; the endpoint resolves it and uses Jambonz mid-call audio control on the tracked active call. |
| Account extensions / SIP credentials | `POST AccessCheck/AccountData` returns name, extension, SIP username, password, and domain | Extension creation provisions a Jambonz client. `POST /vsapi/1.0.0/AccessCheck/AccountData` atomically returns and erases encrypted pending passwords. |

SIP provisioning requires `SIP_CREDENTIAL_ENCRYPTION_SECRET` and a Jambonz account with a
configured SIP realm. Recording archives require the existing Redis worker and configured
S3-compatible storage. No additional production dependency is required.

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

This distinction matters most in `VanillaSoft.VoipApi`: the project is a VanillaSoft web
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
