# Front-End Parity Plans — legacy console → Carameli

Sequenced plans to bring the Carameli front-end to functional parity with the 39 pages of
the legacy vendor's console. The page-by-page breakdown those plans were written against
is an unpublished local reference, not part of this repository. Each plan is sized for
**one fresh session**.

## Foundation (DONE — Phase 0)

The `DataPage` "functional placeholder" system is built and is the pattern every plan
below mirrors. Reference vertical: **Call Events** (`/calls`).

| Layer | File |
| --- | --- |
| Descriptor types | `frontend/src/lib/dataPage.ts` |
| Skin contract | `frontend/src/skins/types.ts` (`SkinViews.DataPage`) |
| Shared renderer | `frontend/src/components/DataView.tsx` |
| Per-skin views | `frontend/src/skins/<skin>/views/DataPage.tsx` |
| Backend list endpoint | `app/api/vsapi/calls.py` → `GET /VsCall/List/{customerId}` |
| Repo / service | `app/repositories/call_event_repo.py::list_for_customer`, `app/services/call_event_service.py` |
| Hook | `frontend/src/hooks/useCallEvents.ts` |
| Page | `frontend/src/pages/CallEvents.tsx` |
| Tests | `tests/unit/test_calls.py`, `frontend/src/tests/useCallEvents.test.ts` |

**The recipe for any new list/report page** (used by all plans below):

1. Backend: `Repo.list_for_customer(customer_id, start, end, limit)` → service wrapper →
   `<Entity>Response` + `<Entity>ListResponse` schema → `GET /.../List/{customerId}` route
   (mirror `app/api/vsapi/calls.py:110`). Add unit tests mirroring the 5 in
   `tests/unit/test_calls.py`.
2. Frontend: `api.<entity>.list()` in `client.ts` → `use<Entity>(): DataPageProps` hook
   (mirror `useCallEvents.ts`) → thin page `return <views.DataPage {...data} />`. Add a
   hook test mirroring `frontend/src/tests/useCallEvents.test.ts`.

### DataPage now supports CRUD (create form + per-row actions)

The `DataPage` contract (`frontend/src/lib/dataPage.ts`) gained two optional fields so a
page can do full CRUD, not just read. **Reference vertical: Webhooks** (`/webhooks`,
`useWebhooks.ts`).

- `form?: DataForm` — renders a "New" button that toggles an inline create form. Fields
  are `{ key, label, kind: 'text' | 'textarea' | 'checkbox', placeholder?, required?, default? }`.
  All values are strings (`'true'`/`'false'` for checkboxes); the hook parses them in
  `onSubmit(values)`, calls the `Add` endpoint, and re-fetches.
- `rowActions?: DataRowAction[]` — renders a trailing "Actions" column. Each handler
  receives the **full row record**, so stash an identifier in a non-column key (e.g. `id`)
  and read it back in `onClick(row)`. Use `variant: 'danger'` for destructive actions
  (Deactivate). The `Button` component supports `primary | ghost | danger`.

Both render in the shared `components/DataView.tsx` (carameli, candy-shop, comic-book) and
in `skins/barebone/views/DataPage.tsx`. **No skin/contract changes are needed** to add a
create form or row action to a new page — just populate `form` / `rowActions` in the hook.
A CRUD vertical adds `POST /.../Add` + `PUT /.../Deactivate/{customerId}/{id}` routes
(mirror `app/api/vsapi/webhooks.py`) with backend tests mirroring
`tests/unit/test_webhook_subscriptions.py`, plus hook tests mirroring `useWebhooks.test.ts`.

## Plan sequence

| Plan | Scope | Backend status | Size | State |
| --- | --- | --- | --- | --- |
| **A** | `plan-A-existing-backends.md` — surface data that already persists | List endpoint is the only new API | 1 session | — |
| **B1** | `plan-B-feature-verticals.md` §B1 — Contacts / Contact Groups | None (owned by CRM) | small | **Done — structural placeholders shipped** |
| **B2** | §B2 — Contact centre: Agents, Queues, Skills | New models + CRUD | 1 session | Ready (decisions resolved) |
| **B3** | §B3 — Extension variants: Group / Intercom / Multicast / Conferences / Parking | New models + CRUD | 1–2 sessions | Ready (decisions resolved) |
| **B4** | §B4 — Media: Music / On-hold / Advertising / Prompts / Voicemail | New models + S3 + CRUD | 1–2 sessions | Ready (needs audio-cell column kind first) |
| **B5** | §B5 — Config: Webhooks mgmt, API tokens, Users, Exemption codes, CDR aggregations | Mixed | 1–2 sessions | **CDR + Webhooks done**; remainder ready |

Plan B batches are independent and can be parallelized across sessions. As of 2026-06-25
the design decisions that blocked them are resolved (see `plan-B-feature-verticals.md`), so
each is a mechanical handoff against the recipe above — the CRUD-capable `DataPage` makes
B2/B3 straight CRUD verticals with no contract work.

## Conventions every plan must honour

- Auth + customer scoping on every route (`enforce_customer_scope`) — `.claude/rules/security.md`
- Model change ⇒ Alembic migration in the same commit — `app/CLAUDE.md`
- Tests in the same commit (5-case backend list test + hook test) — root `CLAUDE.md`
- Hooks never import from `skins/` — descriptor types come from `lib/dataPage.ts`
- Files: ≤300 lines Py / ≤250 lines TSX
