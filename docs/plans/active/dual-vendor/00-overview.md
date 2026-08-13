# Dual-vendor VoIP: Carameli alongside Cloudli

Carameli today is wired into VanillaSoft as a **drop-in replacement** for Cloudli: it
implements `ICloudliService`, it is selected by a global `VoipProvider` appSetting, and its
inbound webhooks are hosted in the `VanillaSoft.CloudliApi` project behind Cloudli's
`X-Cloudli-Auth` header. That shape makes "some customers on Cloudli, some on Carameli"
impossible, and it bakes a vendor name into an abstraction that now has three
implementations (CMV, Cloudli, Carameli).

This track separates vendor *identity* from vendor *interface*, makes vendor selection a
per-line runtime decision instead of a deploy-wide switch, and takes the opportunity to fix
the parts of the legacy contract that are not worth carrying forward.

Goal: **retain every capability Cloudli offers**, while making the vendor a routed detail.
Nothing here removes a feature.

## Where the coupling actually is

Three layers, and only the first is the one people think of.

### 1. The service seam (mechanical)

`ICloudliService` — 26 members, one interface — is referenced **209 times across 71 files**.
The name is the only real problem; the seam itself is in the right place.

`CarameliService` throws `NotImplementedException` on 13 of the 26 members (SCI, message
drop, auto-attendant, pointers, branch assignment, archive export, HUD account data,
`GetCustomer*`). A misrouted customer therefore discovers the gap as a 500 in production.

### 2. Selection (global, must become per-line)

`CloudliServiceFactory.IsCarameliEnabled()` reads one appSetting and picks an implementation
for the whole process. But the precedent for per-customer routing already exists one layer
down: `tblCustomer.CloudliEnabled` is a bit that already routes each customer between CMV and
Cloudli (`CustomerRepository.GetCustomerCloudliSettingAsync`, `sp_CustomerCloudliEnabledUpdate`).

A boolean cannot express three vendors, and **per-customer is not granular enough anyway**:
a DID lives at exactly one carrier at a time, so a customer with 40 numbers migrating to
Carameli ports them in batches and is genuinely split across two vendors for the duration.
Per-customer routing only supports a big-bang cutover per customer.

### 3. Vendor concepts that escaped the abstraction (the real blocker)

**83 occurrences across 27 files** of Cloudli-specific identifiers outside the Cloudli
namespace:

| Leak | Where | Why it blocks two live vendors |
| --- | --- | --- |
| `CloudliExt` | a **column**, via `sp_UserDialingInformationUpdate`; `VanillaSoftWS_Voip.cs` (19), `VanillaSoftWS_DialingInformation.cs` (8) | the per-user SIP identity field is vendor-named; a Carameli user has no "Cloudli ext" |
| `IsCloudliEnabled` | `CmvLineMinVm`, `UserFullVm` | the UI receives a boolean where it needs a vendor |
| `Voip.CloudliVoiceMailNumber` | `Enums/Voip.cs`, branched in the line-assignment email | voicemail access number is picked by `if (isCloudliEnabled)` |
| hardcoded support URL | `VanillaSoftWS_Voip.cs:3661` | vendor help link inlined in an email template |
| `X-Cloudli-Auth` / `CloudliAuthValue` | `CloudliHeaderAttribute`, applied to `CarameliNotifyController` | **both vendors share one static secret**; rotating one rotates both, and a leaked Cloudli secret authenticates as Carameli |
| `CloudliID` mapping | `CloudliMappingService`, `sp_CMVRecordingService*` procs | vendor account id has no general home |

Until these are vendor-neutral, "both simultaneously" fails outside the service layer even if
the service layer is perfect.

## Design

### Rename the seam, keep it

`ICloudliService` → `IVoipService`. `CloudliServiceFactory` → `VoipServiceFactory`. A
mechanical rename across 71 files; no behaviour change, done in its own commit so the
subsequent diffs are readable.

### Route per line, defaulting per customer

```text
VoipVendor  { Cmv, Cloudli, Carameli }

IVoipVendorRouter
    VoipVendor  ForLine(int customerId, string phoneNumberOrExtension)   // owning vendor
    VoipVendor  DefaultFor(int customerId)                               // new provisioning
    IVoipService Resolve(int customerId, string phoneNumberOrExtension = null)
```

Backed by a `tblVoipLineVendor` mapping (`CustomerID`, `PhoneNumberOrExtension`, `Vendor`),
falling back to a `tblCustomer.VoipVendor` column that replaces the `CloudliEnabled` bit.
`CloudliEnabled = 1` migrates to `Cloudli`, `0` to `Cmv`; the old bit stays as a computed
column or view for the duration so nothing breaks in one step.

Inbound is self-routing — whichever vendor's webhook fires identifies itself — so the router
is only needed for outbound and provisioning calls.

### Capabilities instead of `NotImplementedException`

Split the 26-member god-interface along capability lines: provisioning, messaging, call
control, directory/HUD, recordings. A vendor declares which it implements. The router refuses
to *assign* a customer or line to a vendor lacking a capability they use, so the gap surfaces
at configuration time rather than as a 500 mid-call.

This is what lets Carameli be adopted incrementally without pretending to be complete.

### Generalize account mapping

`GetCustomerId` currently throws "Carameli identifies customers by UUID, not a numeric id",
while Cloudli has its own `CloudliID` mapping call. One `tblVoipAccountMapping`
(`VsCustomerID`, `Vendor`, `VendorAccountId` as string) replaces both and can represent a
customer holding accounts at two vendors during a port — which the current bit cannot.

### Give Carameli its own inbound identity

`CarameliNotifyController` moves out of `VanillaSoft.CloudliApi` into its own project (or at
minimum its own auth filter), with its own secret. Prefer HMAC request signing over a static
shared header — Carameli already signs its own inbound webhooks
(`.claude/rules/webhooks.md`), so this makes the two directions consistent.

The controller's honest-status-code contract is **correct and stays**: it returns 200 only
after the DB write lands, which is what makes Carameli's 30 s retry loop a delivery
guarantee. That inversion should spread outward, not be reverted.

## Improvements worth taking while the seam is open

Beyond dual-vendor, these are places where 1:1 replication of Cloudli is actively costing us:

1. **Carameli's own REST API mimics CMV verbs.** `CarameliClient` calls
   `VsExtension/Add` and `VsMessaging/Sms/Enable/{customerId}/{number}` under a
   `/vsapi/1.0.0/` prefix — legacy RPC paths on a greenfield FastAPI service, which then
   return snake_case bodies and `{"detail": ...}` errors that the client maps *back* onto
   `CMVApiResponse`. It is a half-mimic: legacy paths, native bodies, translation on both
   ends. Carameli should expose resource-oriented REST (`POST /extensions`,
   `PATCH /phone-lines/{id}`) and let `CarameliClient` — the adapter, whose whole job this
   is — own the legacy shape. The legacy `vsapi` routes stay published until VanillaSoft
   stops calling them.

2. **Success-in-body envelopes.** `CMVApiResponse` carries success flags in the body while
   HTTP says 200. Carameli's REST already uses real status codes; the CMV envelope should be
   reconstructed in the adapter and nowhere else.

3. **Sync-over-async throughout.** Nearly every `CloudliService`/`CarameliService` member is
   `.GetAwaiter().GetResult()`. `CloudliMappingService`'s own comment documents the ASMX
   `SynchronizationContext` deadlock they are dancing around with `ConfigureAwait(false)`.
   Since the interface changes for the rename anyway, make it `Task`-returning and confine
   blocking to the outermost ASMX boundary.

4. **`CreatePhoneExtension` is a non-atomic loop.** Carameli creates one extension per POST,
   so the client loops the start..end range and returns `Failure` on the first error —
   leaving extensions `1..k` created and reporting total failure. Needs a bulk endpoint on
   Carameli or an explicit partial-success result.

5. **Two `DeletePhoneOrExtension` overloads** differing only by a trailing `cloudliExtension`
   argument, where Cloudli hard-deletes and Carameli soft-deletes. Collapse to one
   deactivate operation; hard delete becomes a separate, explicit call.

## Phases

| # | Delivers | Depends on |
| --- | --- | --- |
| 01 | Rename `ICloudliService` → `IVoipService` and the factory; no behaviour change | — |
| 02 | Vendor-neutralize the leaks: `CloudliExt` → `VendorExtension`, `IsCloudliEnabled` → `Vendor`, voicemail number + help link into a vendor descriptor | 01 |
| 03 | `tblCustomer.VoipVendor` + `tblVoipLineVendor` + `IVoipVendorRouter`; retire the global appSetting | 02 |
| 04 | Capability split of the interface; router refuses unsupported assignments | 03 |
| 05 | `tblVoipAccountMapping` replacing `CloudliID` and the UUID gap | 03 |
| 06 | Carameli inbound gets its own project + signed webhooks | — (parallel) |
| 07 | Carameli-native REST resources; `CarameliClient` becomes the only legacy-shape translator | — (parallel) |

Phases 01–03 are the minimum for two vendors serving customers at the same time. 04–07 are
the architecture payback and can follow.

## Status

Every phase has a VanillaSoft half and, for 06–07, a Carameli half. **The Carameli halves
of 06 and 07 are done**; everything else is open.

| # | Carameli side | VanillaSoft side |
| --- | --- | --- |
| 01–05 | n/a | not started |
| 06 | **done** — outbound notify POSTs carry `X-Carameli-Signature` (HMAC-SHA256 over `"<t>." + body`) keyed by `CARAMELI_NOTIFY_SECRET`, Carameli's own secret | not started — `CarameliNotifyController` still lives in `VanillaSoft.CloudliApi` behind `CloudliHeaderAttribute`, and nothing verifies the signature yet |
| 07 | **done** — `/api/v1/extensions` and `/api/v1/phone-lines` | not started — `CarameliClient` still calls the `/vsapi` verbs |

Notes for whoever picks up the VanillaSoft side:

- **`/vsapi/1.0.0/` is unchanged and stays published.** The native tree is additive, so
  `CarameliClient` can move one call at a time.
- **The signature is additive too.** `X-Cloudli-Auth` is still sent whenever
  `VANILLASOFT_WEBHOOK_SECRET` is set, so staging can adopt verification before the legacy
  header is dropped. To verify: split the header on `,`, recompute
  `HMAC-SHA256(secret, f"{t}." + raw_body)` over the **raw bytes** (Carameli posts a
  pre-serialized body precisely so the two sides hash the same thing), compare with
  `constant-time equals`, and reject a `t` outside ±300 s.
- **Improvement 4 is fixed on this side**: `POST /api/v1/extensions/bulk` creates a range in
  one transaction, so a conflict creates nothing. The `CarameliClient` loop that left
  extensions `1..k` behind can be replaced by one call.
- **Improvement 5 is fixed on this side**: `PATCH /api/v1/phone-lines/{id}` replaces
  `Deactivate`, `UpdateCallRecording`, `SetAutoAttendant` and `VsMessaging/Sms/Enable|Disable`.
  There is one deactivate operation and no hard delete — Carameli never hard-deletes a line
  or extension, so the second `DeletePhoneOrExtension` overload has nothing to map onto.

## Resolved decision: route per line

Per-line routing stands as written — `tblVoipLineVendor` plus the `tblCustomer.VoipVendor`
fallback. Migrations are expected to port numbers in batches, so a customer is genuinely
split across two vendors for the duration, and a customer-level column alone would force a
big-bang cutover per customer.
