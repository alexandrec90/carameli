# Plan B — New Feature Verticals

These cloudli pages need new Carameli backends (or a deliberate decision not to build one).
Each batch below was originally blocked on **open design questions**. As of **2026-06-25**
those questions are resolved (decisions recorded inline), so every batch is now a mechanical
handoff against the recipe in [README.md](README.md) — including the CRUD-capable `DataPage`
(create form + per-row actions) demonstrated by the Webhooks vertical.

> **Structural-placeholder fallback** (still available per page): a `DataPage` with the right
> columns/filters/actions but a hook that returns `rows: []` / `loading: false` and makes no
> API call. Use it for pages whose data is owned elsewhere or whose producer doesn't exist
> yet. Reference: `frontend/src/hooks/usePlaceholderPage.ts` + the per-page wrappers
> (`useContacts`, `useContactGroups`, `useUsers`, `useSubscriptionLogs`).

Follow the README recipe for the mechanical repo→service→schema→route→hook→page→tests wiring;
mirror **Call Events** (read-only list) or **Webhooks** (full CRUD) as appropriate. Honour the
conventions in the README (auth scoping, migration-in-same-commit, tests-in-same-commit,
≤300 Py / ≤250 TSX lines).

> **How to pick this up in a fresh chat.** This file is self-sufficient — you have the repo
> and these decisions; you do not need the prior conversation. Recommended: **implement one
> batch per session** (B2, *or* B3, *or* the B4 column-kind change) — each is independently a
> full session's worth of work — unless the user asks for more in one go. Steps for the batch
> you pick: (1) read the batch
> section below and the README recipe; (2) read the named reference vertical
> (`app/api/vsapi/webhooks.py` + `frontend/src/hooks/useWebhooks.ts` for CRUD,
> `calls.py` + `useCallEvents.ts` for read-only); (3) build backend → migration → frontend →
> tests in the same change; (4) verify with `ruff`/`mypy`/`py_compile` + targeted `pytest`
> (in the `app` container) and `vitest` + `tsc` (in `frontend/`). When done, update the
> **Status** section at the bottom so the next session knows what's left.

---

## Shipped so far (2026-06-25)

- **CDR Summary (B5, §30–34)** — `GET /VsCall/Summary/{customerId}` (group by extension or
  number; counts/avg duration/success rate), `useCallSummary` → `/reports`. No new model.
- **Webhooks management (B5, §5)** — `webhook_subscriptions` table (migration `006`), full
  CRUD (`VsWebhook/List|Add|Deactivate`), `useWebhooks` → `/webhooks` with create form +
  per-row Deactivate. This is the **reference CRUD vertical**.
- **Structural placeholders** — Contacts (§7), Contact Groups (§8), Users (§1),
  Subscription Logs (§3). Routes wired; no backend.

---

## B1 — Contacts (DONE as placeholders)

- **Pages:** Contacts (#7), Contact Groups (#8)
- **Decision:** Contacts/Contact Groups data is **owned by VanillaSoft CRM**
  (`VanillaSoft.Model/Contact/`), not Carameli. Carameli is the telephony layer only, so we
  do **not** build a contacts model here. Shipped as structural placeholders with the cloudli
  columns. If real data is ever needed, surface it via a **read-only proxy to the PubApi**
  contact endpoints — do not create a local `contacts` table.
- **Status:** Complete. Nothing further unless the read-only proxy is requested.

## B2 — Contact Centre (READY — straight CRUD vertical)

- **Pages:** Agents (#35), Call Queue (#36), Skills of agents (#37)
- **Spec sections:** §35–37
- **New models:** `agents` (customer_id, extension_id FK **unique**, name, status),
  `call_queues` (customer_id, name, strategy), `agent_skills` (agent_id, skill, level).
  UUID PK + `created_at`/`updated_at` + soft-delete, matching existing models.
- **Decisions:**
  - **Config-only CRUD first.** Do **not** wire the Jambonz queue engine now
    (`cloudli-feature-gaps.md` flags it as high-effort engine work). These pages are CRUD
    surfaces over config tables; call-routing integration is a later, separate plan.
  - **Agent ↔ extension is 1:1** (`extension_id` FK is unique on `agents`). Reuse the agent
    identity already modelled by `app/api/vsapi/agent_status.py` — do not invent a second one.
- **Endpoints:** `VsAgent/List|Add|Deactivate`, `VsCallQueue/List|Add|Deactivate`,
  `VsAgentSkill/List|Add|Deactivate` (mirror `app/api/vsapi/webhooks.py`).
- **Front-end:** `useAgents` / `useCallQueues` / `useAgentSkills` → `/agents`, `/call-queues`,
  `/agent-skills`. Use the `DataPage` create form + row Deactivate (no contract work needed).

## B3 — Extension Variants (READY — sibling-table CRUD)

- **Pages:** Group Extension (#14), Intercom (#15), Multicast Intercom (#16),
  Telephone conferences (#24), Call Parking (#10)
- **Spec sections:** §10, §14–16, §24
- **Decisions:**
  - **Sibling tables per kind**, NOT a polymorphic `kind` discriminator on the core
    `extensions` table. Each variant gets its own config table (e.g. `intercom_groups`,
    `multicast_groups`, `conferences`, `parking_lots`, `group_extensions`) referencing
    `extensions`/`customers` by FK where needed. Rationale: a discriminator forces sparse,
    variant-specific columns onto the one table that already backs the working Extensions page
    and its `useExtensions` hook — high blast radius, no benefit. The core `extensions`
    contract stays untouched.
  - **Call Parking is config-only** for this plan: model the lot/slots config and CRUD it.
    Defer live slot state (Redis) per `cloudli-feature-gaps.md` to an engine-work follow-up.
- **Front-end:** one CRUD `DataPage` per variant.

## B4 — Media & Audio (READY — needs one small contract add first)

- **Pages:** Music tracks (#21), Custom on hold (#22), Advertising (#20), Prompts (#25),
  Voicemail (#29), Voicemail-Broadcast (#18), Mailbox Drop list (#19)
- **Spec sections:** §18–22, §25, §29
- **New models:** `audio_assets` (customer_id, kind[music|hold|ad|prompt|greeting], name,
  s3_key, duration_seconds). Mailbox Drop *history* needs a `voicemail_drop_events` table (the
  current `app/api/vsapi/voicemail_drop.py` only initiates, persists nothing).
- **Decisions:**
  - **Upload via presigned S3 PUT.** Carameli issues a presigned URL and records the
    `audio_assets` metadata row on completion; the browser uploads bytes straight to S3.
    Do **not** POST audio bytes through FastAPI. (S3 is wired per root `CLAUDE.md`.)
  - **Prerequisite:** an **audio-player cell** needs a new `DataColumn` kind. The current
    `DataColumn` is `{ key, label }` and cells render as strings (`DataView` / barebone).
    Add an optional `kind?: 'text' | 'audio'` to `DataColumn` and render an `<audio>` element
    for `'audio'` cells in `components/DataView.tsx` **and** `skins/barebone/views/DataPage.tsx`
    (mirror exactly how `form` / `rowActions` were threaded through both in the Webhooks work).
    Land this column-kind extension as its own small change before the media pages use it.

## B5 — Config & Reporting (PARTIALLY DONE)

- **Done:** CDR summary reports (#30–34) and Webhooks management (#5) — see "Shipped" above.
  Subscription Logs (#3) and Users (#1) shipped as placeholders.
- **Remaining pages:** API tokens (#4), Exemption codes (#11), Subscriptions config refinement,
  Console (#26), Expansion module (#12), Speed dials (#28), Subscription Logs real backend.
- **Decisions:**
  - **API tokens (#4): single-key read-only view.** `customers.api_key` already exists; do
    **not** build a multi-token model unless rotation/multiple keys becomes a real requirement.
    Surface the existing key (masked) in a read-only `DataPage`.
  - **Users (#1):** VanillaSoft identity concern — placeholder shipped; same read-only-proxy
    note as Contacts if real data is ever needed.
  - **Subscription Logs (#3):** kept as a placeholder because there is **no producer yet** —
    Carameli has no webhook-*delivery* sender. When that sender lands, add a
    `subscription_events` table (id, customer_id, subscription_id FK, event, target, success,
    created_at) and a read-only `VsWebhook/Logs/{customerId}` list endpoint, then swap
    `useSubscriptionLogs` from the placeholder to a fetching hook. Until then, do not guess the
    event schema.
  - **Exemption codes / Speed dials / Expansion module:** straight CRUD verticals against new
    per-feature tables — mirror the Webhooks vertical.

---

## Status

- **B1** complete (placeholders). **B5** fully complete — see below.
- **B2** complete (2026-06-27). Migration `008`, models `Agent`/`CallQueue`/`AgentSkill`,
  full CRUD routes (`VsAgent`, `VsCallQueue`, `VsAgentSkill`), hooks `useAgents` /
  `useCallQueues` / `useAgentSkills`, pages `/agents`, `/call-queues`, `/agent-skills`,
  and tests `test_agents.py` / `test_call_queues.py` / `test_agent_skills.py`.
- **B4** complete (2026-06-27). Migration `009` (`audio_assets`, `voicemail_drop_events`),
  `AudioAsset`/`VoicemailDropEvent` models, `VsAudio` CRUD routes (List, PresignedUpload,
  ConfirmUpload, Deactivate), `VsMailboxDrop/List` read-only route, S3 service for presigned
  URLs, `boto3` added to requirements, voicemail_drop.py updated to persist events, hooks
  `useAudioAssets` (parameterised by kind) / `useVoicemailDropEvents`, pages `/music-tracks`,
  `/on-hold`, `/advertising`, `/prompts`, `/voicemail-greetings`, `/voicemail-broadcast`,
  `/mailbox-drop`, DataColumn `kind: 'audio'` + DataFormField `kind: 'file'` wired through
  `DataView.tsx` and barebone `DataPage.tsx`, tests `test_audio_assets.py` /
  `test_voicemail_drop_events.py` / `useAudioAssets.test.ts` / `useVoicemailDropEvents.test.ts`.
- **B5** fully complete (2026-06-27). Migration `010` (`exemption_codes`, `expansion_modules`,
  `speed_dials`), models `ExemptionCode`/`ExpansionModule`/`SpeedDial`, full CRUD routes
  (`VsExemptionCode`, `VsExpansionModule`, `VsSpeedDial`), read-only `VsToken/List` (masked
  `api_key`), hooks `useExemptionCodes` / `useExpansionModules` / `useSpeedDials` /
  `useApiToken`, pages `/exemption-codes`, `/expansion-modules`, `/speed-dials`, `/api-tokens`,
  `/console` (placeholder — no backend for extension console settings yet), tests
  `test_exemption_codes.py` / `test_expansion_modules.py` / `test_speed_dials.py` /
  `test_api_tokens.py` / `useExemptionCodes.test.ts` / `useExpansionModules.test.ts` /
  `useSpeedDials.test.ts` / `useApiToken.test.ts`. Subscription Logs remains a placeholder
  (no producer yet per plan decision).
- **B3** is an unblocked CRUD vertical — pick it for the next session.
