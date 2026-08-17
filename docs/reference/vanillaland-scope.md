# VanillaLand reading scope

`../VanillaLand/` is the legacy VanillaSoft codebase, kept as the contract reference for
compatibility work (see the *VanillaSoft compatibility* section of the root `CLAUDE.md`).
It is large and mostly irrelevant to Carameli: the VoIP surface is a thin slice of a
CRM. This file records which slice.

It is documentation, not enforcement. It replaces a former root `.claudeignore`, which
tried to express the same thing as ignore patterns — that file was inert, because a
root-relative ignore file cannot match `../` paths outside the project root, and Claude
Code has no `.claudeignore` feature to begin with. Read this before going in; don't
expect a tool to keep you out.

## Worth reading (VoIP / telephony reference)

| Path under `../VanillaLand/AppCode/` | What it covers |
| --- | --- |
| `VanillaSoft.Backend/ConnectMeVoice/` | ConnectMeVoice provider — call control |
| `VanillaSoft.Backend/SMS/` | SMS send/receive backend |
| `VanillaSoft.Backend/Phone*/` | Phone number and line management |
| `VanillaSoft.Backend/Recording/` | Call recording |
| `VanillaSoft.Backend/Routing*/` | Call routing and SCI |
| `VanillaSoft.Backend/Customer/` | Customer/tenant model behind isolation rules |
| `VanillaSoft.Model/VoIP/` | VoIP data model |
| `VanillaSoft.Model/SMS/` | SMS data model |
| `VanillaSoft.Model/Recording/` | Recording data model |
| `VanillaSoft.Model/Contact/CallHistory/` | Call history — maps to Carameli `call_events` |
| `VanillaSoft.Model/PhoneNumber/` | Phone number data model |
| `VanillaSoft.Model/Customer/` | Customer data model |
| `Vanillasoft.Webservice/` | ASMX contracts that Carameli's REST API replaces |
| `ConnectMeVoice/` | CMV client — call + message-drop API surface |
| `CMV*/` | Agent status, call data, recordings services |
| `VanillaSoft.VoipApi/` | VoIP receiver — call + SMS surface, vendor-neutral since the Cloudli/Carameli split; hosts `CloudliController` and `CarameliNotifyController` |
| `VanillaSoft.PubApi/` | Clarity API — call history, IR filters; CloudLi-owned |
| `InBoundMessaging*/` | Inbound SMS webhook patterns |
| `SMSService/` | SMS processing queue |
| `VoipLineCountUpdate*/` | Line usage tracking |
| `vsoft_CallComplianceSvr/` | Call compliance |

## Not worth reading

- **Frontend** — `VanillaSoft.Vue/` is Vue 3 + Kendo UI. Different stack entirely; not a
  feature reference for Carameli's React skins.
- **Main web app** — `Vanillasoft.Web/` is WebForms/IIS. The feature logic lives in
  `VanillaSoft.Backend/`, not here.
- **Portals and out-of-scope apps** — `VanillaSoft.AppointmentSchedulerPortal*/`,
  `VanillaSoft.USHealthPortal/`, `VanillaSoft.Mobile/`, `VanillaSoft.HudApi/`,
  `VanillaSoft.AutokloseIntegration/`.
- **Non-VoIP backend modules** — under `VanillaSoft.Backend/`: `Email/`, `Outlook/`,
  `Google/`, `Salesforce/`, `RingCentral/`, `Gong/`, `Zoom/`, `NetSuite/`, `HubSpot/`,
  `Zapier/`, `ChurnZero/`, `LeadNurturing/`, `LeadStatus/`, `OptimalCallWindow/`,
  `CallingPeriods/`, `Contact/`, `Resulting/`, `ResultsCategory/`, `Import/`, `Export/`,
  `Report/`, `Document/`, `Calendar/`, `Appointment/`, `TCPA/`, `Transcription/`.
- **Non-VoIP data models** — under `VanillaSoft.Model/`: `Email/`, `Calendar/`,
  `Salesforce/`, `Gong/`, `RingCentral/`, `Zoom/`, `ChurnZero/`, `Transcription/`,
  `LeadNurturing/`, `LeadStatus/`, `Resulting/`, `ResultsCategory/`, `Contact/`
  (except `CallHistory/`), `Import/`, `Export/`, `CustomFields/`, `CustomTable/`,
  `AppointmentScheduler/`, `Project/`, `TCPA/`, `Document/`.
- **Non-VoIP Windows services** — `EmailingService/`, `EmailReplyFetcher/`,
  `EmailTroubleshooter/`, `IncomingMailService/`, `CalendarSyncService/`,
  `OutlookCalendarSyncService/`, `LeadNurturingDateTriggerService/`,
  `LeadNurturingUpdateEmailStats/`, `ContactImportService/`, `ContactExportService/`,
  `DailyContactChangesExport/`, `CustomerWebhooksService/`, `EmailDomainStatusUpdate/`,
  `AgentConnectBatchUpdateService/`, `SMSDripService/`, `NotificationService/`,
  `TaskService/`, `TranscriptionService/`, `PMROwnersImport/`, `SalesStaffFTPExport/`,
  `ReleaseContacts/`, `PurchasedContact/`, `FlaggedContactsSummary/`,
  `AddCustomerToDepartment/`, `ConvertOldFiltersToNew/`, `PhoneLogixExport/`,
  `IndexAnalyzer/`, `PasswordUtil/`, and the matching `*.Tests/` projects.
- **Database schema** — `VanillaSoft.Database/` is 52K+ lines of SQL. Too large to read;
  query specific tables instead.
- **Build / deploy / test artifacts** — `ReleasePackages/`, `Scripts/`, `AutoIt/`,
  `UnitTesting/`, `IntegrationTests/`, `VanillaSoft.Web.UI.AccessibilityTests/`, `Docs/`,
  `PostmanCollections/`, and `azure-pipelines.yml`.
