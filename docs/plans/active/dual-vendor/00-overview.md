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

Audited 2026-08-13 against carameli `master` (a46aa97) and the VanillaLand working tree.

Every phase has a VanillaSoft half and, for 06–07, a Carameli half. **The Carameli halves
of 06 and 07 are merged.** Every VanillaSoft half — 01 through 07 — is implemented in the
VanillaLand working tree and **uncommitted**: 146 modified/added/deleted files on
`feature/alex-testing-cloudli`, which that checkout's rules prohibit committing or pushing.
The whole VanillaSoft side of this track exists only as working-tree state.

| # | Carameli side | VanillaSoft side (working tree only) |
| --- | --- | --- |
| 01 | n/a | **done** — `Cloudli/Interfaces/IVoipService.cs` + `Utils/VoipServiceFactory.cs`; `ICloudliService.cs` and `CloudliServiceFactory.cs` deleted |
| 02 | n/a | **done** — `Enums/Voip.cs` deleted in favour of `Voip/VoipVendorDescriptor.cs` (voicemail access number + help URI per vendor); `CloudliExt` → `VendorExtension` through `sp_UserDialingInformation*`; `IsCloudliEnabled` gone from `CmvLineMinVm`/`UserFullVm` |
| 03 | n/a | **done** — `tblCustomer.VoipVendor` (TINYINT + `CK_tblCustomer_VoipVendor`), `tblVoipLineVendor`, `IVoipVendorRouter`/`VoipVendorRouter`/`VoipRoutingRepository`, `RoutedVoipService`; the global appSetting is retired and `POST customer/voip-vendor` replaces it as the write path. See *Closed in the working tree* below for what still needs a UI |
| 04 | n/a | **done** — `Cloudli/Interfaces/IVoipCapabilities.cs` splits the god-interface six ways; `[Flags] VoipCapability` + `IVoipCapabilityProvider`; `AssignLine`/`SetDefault` throw `VoipCapabilityException` on a missing capability. Carameli declares CoreProvisioning, Messaging, Callback, RecordingConfiguration, AccountProvisioning |
| 05 | n/a | **done** — `tblVoipAccountMapping.sql`; `GetVendorAccountId` replaces the `CloudliID` call and the UUID `GetCustomerId` gap |
| 06 | **merged** — outbound notify POSTs carry only `X-Carameli-Signature` (HMAC-SHA256 over `"<t>." + body`) keyed by `CARAMELI_NOTIFY_SECRET`; Carameli no longer transmits Cloudli's credential | **done** — fail-closed `CarameliSignatureAttribute` on `CarameliNotifyController`, ±300 s replay window, constant-time compare, `CarameliSignatureVerifierTests`, `CarameliNotifySecret` in `Web.config` |
| 07 | **merged** — `/api/v1/extensions` (incl. `/bulk`) and `/api/v1/phone-lines`; `/vsapi/1.0.0/` still published | **done** — `CarameliClient` uses the native resource routes for extension and phone-line operations, including one atomic bulk extension request; legacy-only SMS send, customer, callback, and area-code calls remain on `/vsapi` |

Every added file is registered in its project (`VanillaSoft.Backend.csproj`,
`VanillaSoft.CloudliApi.csproj`, `UnitTesting.csproj`, `VanillaSoft.sqlproj`), so the tree
is compile-complete as far as static inspection can tell. Neither side has been built or
run against a live VanillaSoft; the Carameli halves are covered by 91 passing unit tests
(`test_rest_extensions`, `test_rest_phone_lines`, `test_vanillasoft_notify`).

### Closed in the working tree: routing a customer to Carameli

Phase 03 retired the global `CarameliEnabled` appSetting without delivering a replacement
write path, so `tblCustomer.VoipVendor` could never hold `2`. `VoipVendorRouter.SetDefault`
— the capability-gated writer — had no caller outside `VoipVendorRouterTests`, and the only
production writer was `sp_CustomerCloudliEnabledUpdate`, which derives
`VoipVendor = CASE WHEN @CloudliEnabled = 1 THEN 1 ELSE 0 END` from a bit. Two values,
neither of them Carameli. Every customer resolved to Cmv or Cloudli and `tblVoipLineVendor`
could only ever accumulate those two.

`POST customer/voip-vendor` on `CloudliController` is the three-valued replacement, added
to the VanillaLand working tree alongside the rest of this track:

- takes `{ CustomerId, Vendor, RequiredCapabilities, CloudliId }` and parses the vendor name
  case-insensitively, rejecting both unknown names and numeric values outside the enum;
- moves Cloudli's third-party account state **before** the local write when Cloudli is at
  either end of the change, so a failure there writes nothing locally;
- calls `SetDefault`, which runs the capability gate and keeps the legacy `CloudliEnabled`
  bit consistent with the new column, and turns a `VoipCapabilityException` into a 400 —
  the configuration-time refusal the capability split exists to produce;
- is covered by `UnitTesting/Voip/VoipVendorAdminTests.cs` (9 tests). `IVoipVendorRouter` is
  now registered in `VanillaSoft.CloudliApi`'s container, matching `Vanillasoft.Webservice`.

Two things remain before a customer can actually be moved in production:

1. **An admin UI.** The classic-ASP customer page still renders a `CloudliEnabled` checkbox;
   it needs a three-vendor control posting to this endpoint.
2. **The endpoint's credential.** It sits on `CloudliController`, so it inherits Cloudli's
   static `X-Cloudli-Auth` header — the wrong credential for a vendor-neutral admin call.
   It should move when the admin surface gets an auth scheme of its own.

### Smaller gaps

- **Improvement 3 (sync-over-async) not taken.** `IVoipService` has no `Task`-returning
  member and `CarameliService`/`CmvVoipService`/`CloudliService` still
  `.GetAwaiter().GetResult()` throughout. The interface changed for the rename, which was
  the cheap moment to do this; it is now a separate change.
- **Improvement 5 half-taken.** Carameli collapsed to one `PATCH` and never hard-deletes,
  but `IVoipProvisioningService` still carries both `DeletePhoneOrExtension` overloads.
- **The HUD stack is still a boolean.** `VanillaSoft.HudApi` has its own `ICloudliService`
  whose every member takes `bool isCloudliEnabled`, and `cloudliHud.js` /
  `vanillaSoftWSCloudliHud.js` / the classic-ASP pages pass `is-cloudli-enabled` on the
  query string. Carameli not declaring `HudDirectory` keeps the router from assigning a
  HUD-using line to it, but the HUD path never consults the router — it reads
  `Session("CloudliEnabled")`. It is outside the phase table's scope and needs to be in it.

Notes for whoever picks up the VanillaSoft side:

- **`/vsapi/1.0.0/` is unchanged and stays published.** The native tree is additive, so
  `CarameliClient` can move one call at a time.
- **The signature is the only Carameli notify credential.** `VANILLASOFT_WEBHOOK_SECRET`
  remains for Carameli's legacy `/vs-log` receiver but is never sent on notify POSTs. The
  VanillaSoft verifier splits the signature header on `,`, recomputes
  `HMAC-SHA256(secret, f"{t}." + raw_body)` over the **raw bytes**, compares in constant
  time, and rejects a `t` outside ±300 s. Deployment must set matching
  `CARAMELI_NOTIFY_SECRET` / `CarameliNotifySecret` values before these working trees ship.
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
