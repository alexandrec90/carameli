# Phase 04 — Error Tracking (Sentry SDK, GlitchTip-compatible)

> No stack dependency for the code change; needs a DSN (Sentry SaaS free tier or
> self-hosted GlitchTip) for live verification — code must work fine without one.

Goal: unhandled errors in the FastAPI app **and** the ARQ worker get grouped, stack-traced,
and alertable instead of scrolling into a 60 MB rotating log nobody watches. GlitchTip
speaks the Sentry protocol, so the SDK choice covers both; picking the actual backend is
an ops decision that can wait — the code just takes a DSN.

## Implementation

1. **Dependency** (follow root `CLAUDE.md` → Dependencies exactly):
   `sentry-sdk[fastapi,arq]` floor added to **`requirements.in`** (runtime — the worker
   container imports it), then recompile all three locks with
   `--universal` in the same commit (VS Code task "Deps: Recompile Python Lockfiles").
2. **Settings** (`app/core/config.py` + `.env.example`):
   - `sentry_dsn: str = ""` (empty = disabled — the default posture)
   - `sentry_environment: str = "dev"`
   - `sentry_traces_sample_rate: float = 0.0` (errors only; tracing is not this phase)
3. **Init helper** — new `app/core/error_tracking.py`:

       def init_error_tracking() -> bool:
           """Initialise Sentry if a DSN is configured. Returns True if enabled."""

   Guard on empty DSN; call `sentry_sdk.init` with `FastApiIntegration` +
   `ArqIntegration`, `environment`, `traces_sample_rate`. Log one INFO line either way
   (per `.claude/rules/logging-backend.md`; **never log the DSN itself** — secrets rule).
4. **Wire-up:**
   - `app/main.py`: call `init_error_tracking()` during startup, **before** the app
     handles traffic. **Do not remove or weaken the global exception handler** — root
     `CLAUDE.md` forbids it; Sentry's middleware captures the exception before the
     handler formats the 500 response, so both coexist.
   - Worker: `ArqIntegration` hooks ARQ globally from the same `sentry_sdk.init`, but the
     worker process never runs `app/main.py` — call `init_error_tracking()` in
     `worker_startup` (`app/services/call_sync.py:80`) too.
5. **PII posture:** leave `send_default_pii` at its default (off). Phone numbers ride in
   log messages/extras already captured by handlers — acceptable; don't add request-body
   capture.

## Tests (same commit)

- `init_error_tracking` returns False and does not call `sentry_sdk.init` when DSN empty
  (monkeypatch settings; mock `sentry_sdk.init`).
- Returns True and passes DSN/environment/sample-rate through when configured.
- App startup path: with DSN unset, app still boots (existing startup tests cover this
  implicitly — extend one to assert no Sentry init side effect if cheap).

## Verify

1. Targeted pytest + `ruff` + `mypy`.
2. Stack boots with no DSN set — zero behavior change, INFO line "error tracking
   disabled".
3. Live check (if a DSN is available): set `SENTRY_DSN` in `.env`, restart app (**ask
   user first — drops sessions**), hit a route that raises (add a temporary throw or use
   an existing 500 path), confirm the event in the Sentry/GlitchTip UI, including one
   thrown from inside an ARQ cron (e.g. temporarily raise in `retry_unposted_events`).
   Revert temporary throws.

## Explicitly out of scope

- Choosing/hosting GlitchTip vs Sentry SaaS (ops decision; document both in README).
- Performance tracing, profiling, release tracking, alert-rule config in the Sentry UI.
