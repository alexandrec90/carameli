# Phase 05 — Live E2E suite + the diagnostics map

> Read `00-overview.md` first. Carameli repo only. Two deliverables: (1) a live E2E test
> suite that drives the real integration (real Telnyx, jambonz.cloud, ngrok, CRM
> staging) and (2) a diagnostics doc that maps every failure mode to where its evidence
> lands, so a coding agent can triage without rediscovering the architecture. Backend
> only — no Carameli front-end coverage. Assumes phases 01–04 are merged (02's honest
> receiver is what makes the strongest assertion here valid); degrade gracefully if not
> (see markers below).

## Ground rules for the suite

- **Costs real money** (cents/run: call minutes + SMS) and **needs live infrastructure**.
  Never runs in CI, never in the default pytest collection.
- Location `tests/e2e/`, marker `live_e2e` — register the marker wherever the repo
  registers markers today (check `pyproject.toml` / `pytest.ini` / `tests/conftest.py`
  for an existing `markers` section and follow it; also check how `tests/integration/`
  gates on `TELNYX_SANDBOX` for the skip-idiom to copy).
- **Do not use the unit/integration DB fixtures.** The savepoint-isolation fixtures in
  `tests/` (see `tests/CLAUDE.md`) wrap a *test* database; the E2E suite observes the
  *live running stack* from outside. All assertions go through Carameli's HTTP API (and
  optionally the log file) — never a raw DB session. A module-level `conftest.py` in
  `tests/e2e/` must therefore NOT import the shared DB fixtures; give it its own tiny
  fixtures (httpx client, config from env).
- Whole suite skips (with a clear reason string) unless `RUN_LIVE_E2E=1` **and** the
  required env vars are set.

### Environment contract (document in the suite's module docstring + `.env.example` comments)

| Var | Meaning |
| --- | --- |
| `RUN_LIVE_E2E` | `1` to enable the suite |
| `E2E_BASE_URL` | Carameli's public base (the ngrok URL) or `http://localhost:8000` |
| `E2E_API_KEY` | Bearer key for a dedicated **E2E test customer** (create once via `POST /vsapi/1.0.0/VsCustomer/Create`; don't reuse a real customer) |
| `E2E_DID_A`, `E2E_DID_B` | Two owned Canadian test DIDs on the E2E customer (roadmap C6); B is the "inbound" target |
| `E2E_VS_CHECK` | optional `1`: also assert CRM-side via PubApi (needs `E2E_PUBAPI_*` creds) — otherwise `posted=True` is the VS assertion |

## Shared helpers (`tests/e2e/helpers.py`, unit-testable pure parts get unit tests)

- `async poll_until(fn, timeout_s=90, interval_s=3)` — poll an async predicate, raise
  `TimeoutError` with the last observed value in the message (that message is what a human
  or agent debugs from — make it informative).
- A thin authed `httpx.AsyncClient` wrapper for Carameli's API.
- Log-tail helper: read `logs/runtime/carameli.log` since a captured offset (the suite
  runs on the same machine as the stack) so tests can assert "no new ERROR lines during
  this test" and reference `vs.`-shipped entries.

## The flows (one test module each; each drives the flow then polls Carameli's read APIs)

Find the exact read endpoints before writing assertions (Grep `app/api/vsapi/` for the
call-events/SMS listing routes rather than trusting this doc). Every test asserts *at
minimum*: the expected row appears via the API, and — the airtight part — its `posted`
flag goes `True` within the retry window (30 s cron + margin). With the honest receiver,
`posted=True` **means** CRM durably processed it; that's the loop-closing assertion.

1. **Outbound SMS** — `Sms/Send` from DID A to DID B → poll the outbound row + delivery
   receipt status; receipt forwarding to VS asserted via `posted` on the receipt path.
2. **Inbound SMS** — same send *is* B's inbound: poll for the inbound `sms_messages` row
   for DID B (one real SMS exercises both directions; don't send twice).
3. **Outbound call (click-to-call)** — `Callback/ByExtension` needs a human to answer.
   For unattended runs, originate via the **Telnyx API directly** from DID A to DID B
   instead: B's inbound routing (jambonz app → Carameli webhooks) fires, producing a real
   inbound `call_events` row. Let it ring ~10 s, hang up via the API, poll for the row with
   a terminal status and `posted=True`. Mark the true click-to-call variant
   `@pytest.mark.manual` (register that marker too) for attended runs.
4. **Inbound call** — covered by 3 (the origination *is* the inbound leg). Keep them as
   one module unless assertions get muddy.
5. **Recording** — only if roadmap A6 (recording pipeline) is implemented by then: recorded
   call → poll `call_events.recording_url` → GET the Carameli-served URL (expect 200,
   `audio/*`) → recording notify `posted=True`. Otherwise `pytest.skip("A6 not implemented")`
   — do not silently omit the test file; the skip is the tracking.
6. **Failure-path probe (cheap, no telephony)** — POST a syntactically valid but
   unprocessable notify... actually drive it from the real system: temporarily unset —
   no. Keep it simple and non-destructive: send an SMS while `E2E_VS_CHECK` staging is
   known-good and assert the log-tail helper saw **zero** unposted-retry ERRORs; the
   negative-path unit coverage already lives in phases 01–04. Don't engineer live failure
   injection into this suite (killing ngrok mid-run is a documented *manual* drill — see
   the diagnostics doc — not an automated test).

If `E2E_VS_CHECK=1`: after flow 3, query CRM's PubApi call-history read
(`CRM.PubApi` `CallHistoryController` — confirm route/auth in the LegacyCRM repo)
for the call and assert it exists — belt-and-suspenders proof independent of `posted`.

## Deliverable 2 — `docs/operations/diagnostics-error-map.md`

A single doc a fresh agent reads when "something didn't work". Contents:

1. **The map** — a table: failure mode → where the evidence is → what to grep/query.
   Rows: Carameli 500s (global handler → `carameli.log`); notify rejected by VS
   (`carameli.log` warning with response body, phase 01); VS-side processing failure
   (honest 4xx/5xx body in the same log line, phase 02); VS-internal/client-side errors
   (`| vs.Carameli.` entries shipped via phase 03); webhook never arrived (phase 04
   `Reconciliation:` ERRORs); unposted backlog (rows with `posted=false` older than a few
   minutes — query via `mcp__postgres__query`); everything in `logs/runtime/carameli.log`.
2. **The ngrok inspector** — ngrok's local API records every tunneled request+response:
   `GET http://127.0.0.1:4040/api/requests/http?limit=50` (JSON; filterable). Document
   2–3 concrete curl/httpx one-liners: "did jambonz call us in the last 5 min", "what did
   we answer", "replay a request" (`POST /api/requests/http/{id}/replay` — flag as
   mutating; agents ask before replaying). Note: inspector state is in-memory, lost on
   tunnel restart.
3. **Correlation recipe** — one call's `call_sid` joins: jambonz portal ↔ ngrok inspector
   ↔ `carameli.log` ↔ `call_events.call_sid` ↔ VS `notify/IncomingCall` `callId` ↔
   (staging) `sp_CMVCallNotificationInsert` rows. Same for `message_sid`/`referenceId`.
4. **Manual drills** — the ngrok-outage drill: kill ngrok, place a test call, restart
   ngrok, wait one reconciliation interval, expect the `Reconciliation:` ERROR; then the
   recovery story (provider-side webhook retries and/or manual replay).
5. How to run the E2E suite (`RUN_LIVE_E2E=1 pytest tests/e2e -m live_e2e`), expected
   cost, and the env contract table.

Add one pointer line to `CLAUDE.md`'s Logging section
(`docs/operations/diagnostics-error-map.md` —
where every integration error lands) so agents discover it. Keep the CLAUDE.md edit to
that single line (authoring rule: only non-obvious pointers).

## Tests-for-the-tests + verify

- Unit-test the pure helper logic (`poll_until` timeout/last-value message, log-tail
  offset reading) in `tests/unit/test_e2e_helpers.py` — that's the same-commit test
  coverage for this phase even when nobody runs the live suite.
- `ruff check tests/e2e/ tests/unit/test_e2e_helpers.py`, `mypy tests/e2e/helpers.py`,
  `pytest tests/unit/test_e2e_helpers.py`.
- Collection check without the env set: `pytest tests/e2e -m live_e2e --collect-only`
  must show the suite collected-but-skipped (proves no import-time explosions and that
  CI's default run stays clean).
- First live run is a human-in-the-loop event: run one module at a time, watch
  `carameli.log`, record results in the PR body.
