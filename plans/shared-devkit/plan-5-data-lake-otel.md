# Plan 5 — Shared data lake and cross-project OTel conventions

**Depends on:** nothing. Fully independent of Plans 1–4.
**Read first:** `plans/shared-devkit/README.md`.

## Goal

The remote-hosted data lake currently exists only in `ibkr`. Make it a shared service that
every project reports into, and standardize the telemetry conventions so the data is
actually joinable across projects rather than three disconnected silos.

## Why this is separate from the devkit repo

The data lake is a **deployed service** with its own lifecycle, infrastructure, cost, and
uptime concerns. It gets its own repo. What lands in `devkit` is only:

- a thin client / exporter config
- the resource-attribute conventions (Step 2)
- a rule file documenting what to instrument and what never to send

## Step 0 — Survey first (this plan is the least specified)

Unlike Plans 1–4, the current state here has **not** been inspected — the lake lives in
`ibkr`, which was not read. Before designing anything, answer:

- What is it actually built on (warehouse? object store + query engine? Postgres?)
- What writes to it today, and in what format
- Is it already OTel-shaped, or a bespoke schema
- What does it cost, and who pays when three projects write instead of one
- Auth model for a second and third writer

Do not port the Carameli side until these are answered. A wrong guess here is expensive.

## Step 1 — The free win: agent telemetry

Carameli's `.claude/settings.json` **already** exports Claude Code telemetry:

```json
"CLAUDE_CODE_ENABLE_TELEMETRY": "1",
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf"
```

Pointing that at the shared lake instead of localhost gives **cross-project agent
analytics for nearly zero work** — token spend, session counts, and tool usage across
every repo in one place. Given the standing token-quota constraint, that visibility is
probably the single highest-leverage item in this whole plan set.

Two caveats to resolve:

- The README notes telemetry export is **shared, not offset** across worktrees. Adding a
  `service.instance.id` or worktree attribute is needed to tell parallel stacks apart.
- Local collector vs. direct remote export: keep the local collector
  (`otel-collector-config.yaml` exists) and add the lake as a second exporter. Direct
  export from the CLI to a remote endpoint couples every session to network availability.

This step is worth doing **first and alone** — it delivers value before any of the harder
lake work and validates the auth/ingest path with low-stakes data.

## Step 2 — Resource attribute conventions

Every producer sets the same attributes or the data won't join:

| Attribute | Value | Why |
| --- | --- | --- |
| `service.name` | `carameli`, `ibkr`, … | primary partition key |
| `service.instance.id` | worktree / stack identifier | disambiguates parallel stacks |
| `deployment.environment` | `local`, `ci`, `prod` | keeps dev noise out of real dashboards |
| `service.version` | git SHA or tag | correlates regressions to deploys |

Ship these as a `devkit` helper that reads them from env with sane fallbacks, plus a rule
file so agents instrument consistently.

## Step 3 — What flows into the lake

Beyond agent telemetry, the candidates already produced by this toolchain:

- `logs/agent/skills-profile.json` and `logs/agent/error-ledger.json` — the fixer
  feedback-loop data (see `plans/fixer-feedback-loop/README.md`). Cross-project fixer
  effectiveness is a genuinely new signal that per-repo JSON can't give.
- CI run outcomes and durations from the reusable gate (Plan 3)
- Lint/test failure signatures via the `diagnostics.py` contract (Plan 2)

> ⚠️ Carry forward the interpretation caveat from the fixer plans: per-segment
> `input`/`cache_read` token counts reflect ambient session context, **not** a skill's own
> cost. Act on **output tokens and trends** only. If that caveat doesn't travel with the
> data into the lake, the dashboards will be confidently wrong.

## Step 4 — What must never be sent

Write this down before the first byte ships, not after an incident:

- No `.env` values, API keys, or `API_KEY_SECRET` / `SESSION_SECRET`
- No customer data, phone numbers, or call recordings — Carameli handles all three
- No raw prompt/response bodies from agent sessions
- Log *signatures* (already normalized by `diagnostics.py`), not raw log lines, which can
  contain any of the above

The existing `detect-secrets` baseline and `lint-secrets` skill cover the repo. They do
**not** cover an exporter. This needs its own explicit allowlist of fields.

## Tests

- Exporter unit tests: attributes present, redaction allowlist enforced, failure to reach
  the lake degrades gracefully (never blocks a build or a session).
- An ingest smoke test per project, runnable from CI.
- A negative test asserting a payload containing a known secret pattern is dropped.

## Definition of done

- [ ] Step 0 survey answered and written into this file
- [ ] Agent telemetry from Carameli lands in the shared lake, tagged by `service.name`
- [ ] Resource-attribute helper + rule shipped in devkit
- [ ] Redaction allowlist implemented and negatively tested
- [ ] Exporter failure never blocks a build or session
- [ ] At least one cross-project dashboard exists that a per-repo view could not produce
