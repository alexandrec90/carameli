# Carameli Front-End Gap Analysis (vs Cloudli)

Maps each of Cloudli's 39 pages (see `cloudli-functional-spec.md`) to the Carameli
front-end. **This file is about the UI only** — backend/API status is tracked separately
in `cloudli-feature-gaps.md`. A page can have a working API but no UI.

> **Superseded for VanillaLand scope by `../vanillaland-e2e-ui-features.md`.** The route
> inventory below is stale — it predates the current `routes.ts` (6 routes then, 27 now).
> Use this file for the full Cloudli page-by-page comparison; use the newer doc for the
> gap list an end-to-end VanillaLand experience actually needs.

## Legend

| Symbol | Front-end status |
|---|---|
| ✅ | Functional view (real hook + skin view, all skins) |
| 🟡 | Static placeholder route (`<views.Placeholder>` — title/description only, no logic) |
| ❌ | No route at all |

Backend column: ✅ shipped · ⚠️ partial · ❌ none (per `cloudli-feature-gaps.md`).

## Current Carameli routes

`routes.ts` defines exactly 6 routes. Only Dashboard / Phone Lines / Extensions are wired
to hooks (`useDashboard`, `usePhoneLines`, `useExtensions`); SMS / Call Events / Settings
render the static `Placeholder`.

---

## Page-by-page mapping

| # | Cloudli page | Carameli route | FE | Backend | Notes |
|---|---|---|---|---|---|
| 1 | Users | — | ❌ | ❌ | No user-management UI or account/user lifecycle endpoint |
| 2 | Subscriptions (API) | — | ❌ | ⚠️ | Webhook subscriptions exist server-side; no management UI |
| 3 | Subscription Logs (by period) | — | ❌ | ⚠️ | `call_events` is closest; no subscription-event log or date-range report UI |
| 4 | API login token | (Settings) | ❌ | ✅ | Bearer keys exist; no key-management screen |
| 5 | Webhook | — | ❌ | ✅ | Webhook ingestion works; no config UI (Description/Events table) |
| 6 | Call Screening | — | ❌ | ❌ | Blocklist not implemented (SCI zip filter is unrelated) |
| 7 | Contacts | — | ❌ | ❌ | No contacts model/UI |
| 8 | Contact Groups | — | ❌ | ❌ | — |
| 9 | Telephone devices (provisioning) | (Extensions) | ❌ | ⚠️ | Extensions exist; no device/MAC provisioning UI |
| 10 | Call Parking | — | ❌ | ❌ | — |
| 11 | Exemption codes | — | ❌ | ❌ | Call-restriction exemptions |
| 12 | Expansion module | — | ❌ | ❌ | Receptionist BLF modules |
| 13 | **Extensions** | **/extensions** | ✅ | ✅ | **Implemented** (list + add). Cloudli columns richer (Type, Device, Status, Call recording, Last seen) |
| 14 | Group Extension | — | ❌ | ❌ | — |
| 15 | Intercom Extension | — | ❌ | ❌ | — |
| 16 | Multicast Intercom | — | ❌ | ❌ | — |
| 17 | Menu Component (IVR) | — | ❌ | ❌ | IVR menus |
| 18 | Voicemail – Broadcast | — | ❌ | ❌ | — |
| 19 | Mailbox Drop | — | ❌ | ✅ | `voicemail_drop` service exists; no UI |
| 20 | Advertising | — | ❌ | ❌ | On-hold ad bank |
| 21 | Music tracks | — | ❌ | ❌ | — |
| 22 | Custom on hold | — | ❌ | ❌ | — |
| 23 | **VoIP Number** | **/phone-lines** | ✅ | ✅ | **Implemented** (maps to `phone_lines`) |
| 24 | Telephone conferences | — | ❌ | ❌ | Permanent conference bridges |
| 25 | Prompts | — | ❌ | ❌ | Audio prompt library |
| 26 | Console settings | /settings | 🟡 | ⚠️ | Settings route is a static placeholder |
| 27 | SMS Numbers | /sms | 🟡 | ✅ | SMS send/receive backend works; UI is a placeholder |
| 28 | Speed dials | — | ❌ | ❌ | — |
| 29 | Voicemail | — | ❌ | ❌ | No mailbox/greetings UI |
| 30 | Call Statistics (CDR dashboard) | /calls | 🟡 | ⚠️ | `call_events` table exists; no aggregation/report UI |
| 31 | Summary – Extension (date) | /calls | 🟡 | ⚠️ | date-range report (1 date field) |
| 32 | Summary – Extension (period) | /calls | 🟡 | ⚠️ | date-range report (2 date fields) |
| 33 | Summary – Phone Number (date) | /calls | 🟡 | ⚠️ | — |
| 34 | Summary – Phone Number (period) | /calls | 🟡 | ⚠️ | — |
| 35 | Agents | — | ❌ | ❌ | Contact-centre agents |
| 36 | Call Queue | — | ❌ | ❌ | — |
| 37 | Skills of agents | — | ❌ | ❌ | — |

## Tally (front-end)

- ✅ Functional: **2** cloudli pages (Extensions, VoIP Number) + Dashboard (no cloudli equivalent; Carameli overview).
- 🟡 Placeholder: **3** routes covering **7** cloudli pages (SMS; Console/Settings; the 5 CDR/report pages all behind one `/calls`).
- ❌ No route: **~28** cloudli pages.

## Cross-cutting UI capabilities Cloudli has on nearly every page (Carameli lacks generically)

These appear on almost every cloudli list page and are the real "structural" baseline:

1. **List + search filter** — every `WebSimpleList` page.
2. **Date-range reporting** — Start/End date filters + Generate/Export/Print (all CDR + subscription-log pages).
3. **Row-level actions** and **NEW / Export** toolbar on lists.
4. **Per-page CRUD form** behind NEW.

Carameli's Extensions/Phone Lines views implement a bespoke subset (list + add) but there
is **no generic list/filter/report scaffolding**, so each new page is built from scratch.
This is the gap that "functional placeholders" (below) would close.
