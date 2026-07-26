# Test Implementation Checklist (Blue-Sky)

Comprehensive testing roadmap for Carameli, assuming provider credentials and infra are fully available.

## 0) Environment Setup Playbook (do this first)

Use this section as the practical prerequisite checklist before implementing the expanded test plan.

### A. Local foundation

- [ ] Docker Desktop is installed and running
- [ ] Project `.venv` exists (needed for host-side Playwright E2E)
- [ ] Frontend dependencies installed in `frontend/`
- [ ] `.env` exists and is populated from `.env.example`

### B. Core secrets and env vars

Fill these in `.env` before enabling live-provider and webhook suites.

| Variable | Required for | Notes |
| --- | --- | --- |
| `API_KEY_SECRET` | Authenticated API tests, CI parity | Bearer secret used by protected routes |
| `TELNYX_API_KEY` | Telnyx sandbox/live integration tests | Test key (sandbox) or live key |
| `TELNYX_WEBHOOK_SECRET` | Telnyx webhook signature validation tests | Must match Telnyx portal configuration |
| `TELNYX_WEBHOOK_BASE_URL` | Telnyx callback routing | Usually your ngrok HTTPS URL in local dev |
| `JAMBONZ_ACCOUNT_SID` | Jambonz integration tests | Account credential |
| `JAMBONZ_API_KEY` | Jambonz integration tests | API credential |
| `JAMBONZ_WEBHOOK_SECRET` | Jambonz webhook signature validation tests | Must match Jambonz configuration |
| `JAMBONZ_WEBHOOK_BASE_URL` | Jambonz callback routing | Usually your ngrok HTTPS URL in local dev |
| `ENCRYPTION_SECRET` | Jambonz credential encryption | Required by Jambonz stack |
| `JWT_SECRET` | Jambonz auth internals / local stack | Keep non-default outside local-only setups |
| `NGROK_URL` | Webhook E2E tests (`test_webhook_e2e.py`) | Auto-populated by ngrok helper script/task |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | S3/MinIO recording integration tests | Use MinIO defaults locally or real S3 values |
| `VANILLASOFT_WEBHOOK_URL` | `retry_unposted_events` ARQ job | URL where completed call events are POSTed to VanillaSoft |
| `VANILLASOFT_WEBHOOK_SECRET` | Outbound call event HMAC signing | Must match VanillaSoft portal configuration |
| `SESSION_SECRET` | Session cookie signing (`POST /session`) | Must be non-default outside local-only setups |

> **Note:** `ENCRYPTION_SECRET` and `JWT_SECRET` are Jambonz stack variables — set them in `docker-compose.yml`, not `.env`. They are not loaded by `app/core/config.py`.

### C. Telnyx account setup checklist

- [ ] Create/verify Telnyx account
- [ ] Generate API key and place it in `TELNYX_API_KEY`
- [ ] Configure webhook signing secret; place it in `TELNYX_WEBHOOK_SECRET`
- [ ] Point Telnyx webhook endpoint(s) to: `https://<public-url>/webhooks/telnyx`
- [ ] For sandbox test suite, set `TELNYX_SANDBOX=1` when running `tests/integration/test_telnyx_sandbox.py`
- [ ] Confirm account has number/search permissions needed by DID tests

Notes:

- The sandbox suite is intentionally opt-in and skipped unless `TELNYX_SANDBOX=1`.
- Some SMS sandbox cases may return expected 4xx behavior depending on account/test mode.

### D. Jambonz setup checklist

- [ ] Create/verify Jambonz account and API credentials
- [ ] Set `JAMBONZ_ACCOUNT_SID` and `JAMBONZ_API_KEY`
- [ ] Set `JAMBONZ_WEBHOOK_SECRET`
- [ ] Point call-status callback to: `https://<public-url>/webhooks/jambonz/call-status`
- [ ] Ensure `ENCRYPTION_SECRET` and `JWT_SECRET` are set (non-empty)

### E. ngrok setup checklist (for webhook-reachability and live callbacks)

- [ ] Install ngrok CLI and authenticate it with your ngrok account token
- [ ] Start tunnel for backend port `8000`
- [ ] Use the repo task `Start: ngrok + Patch .env + Restart App` to auto:
  - update `JAMBONZ_WEBHOOK_BASE_URL`
  - update `TELNYX_WEBHOOK_BASE_URL`
  - update `NGROK_URL`
  - restart the app container
- [ ] Verify ngrok dashboard is reachable at `http://localhost:4040`
- [ ] Reconfigure provider webhook endpoints any time ngrok URL changes

### F. Service readiness checks before running test families

- [ ] Backend health endpoint responds (`/health` on port `8000`)
- [ ] Frontend dev server responds on port `5173` (needed for browser E2E)
- [ ] DB/Redis are running (required for most backend suites)
- [ ] MinIO/S3 endpoint reachable before `test_s3_storage.py`
- [ ] ARQ worker process running (`docker compose up worker`) before background job tests

### G. Which setup is needed for each suite?

| Suite | Requires ngrok | Requires provider keys | Requires frontend dev server | Requires MinIO/S3 | Requires ARQ worker |
| --- | --- | --- | --- | --- | --- |
| `tests/unit/**` | No | No (mocked boundaries) | No | No | No (jobs mocked) |
| `tests/integration/test_full_flows.py` | No | No (mocked boundaries) | No | No | No |
| `tests/integration/test_contract.py` | No | No (mocked boundaries) | No | No | No |
| `tests/integration/test_telnyx_sandbox.py` | Usually no | Yes (`TELNYX_API_KEY`, `TELNYX_SANDBOX=1`) | No | No | No |
| `tests/integration/test_webhook_e2e.py` | Yes (`NGROK_URL`) | Optional for reachability checks | No | No | No |
| `tests/integration/test_s3_storage.py` | No | No | No | Yes | No |
| Background job integration tests (future) | No | No | No | No | Yes |
| `tests/e2e/**` | No | Not typically | Yes (`localhost:5173`) | No | No |
| Local CI (`scripts/run-ci.ps1`) | No (unless adding live webhook suites) | Not for default run | Yes for browser-smoke readiness check | No | No |

### H. Cost / safety guardrails (important)

- [ ] Keep live-provision/release DID tests sandbox-only unless explicitly approved
- [ ] Tag chargeable tests and exclude from PR gate by default
- [ ] Use dedicated test customer/accounts to avoid polluting production resources
- [ ] Rotate exposed webhook URLs/secrets after test campaigns

### I. Recommended execution order for first-time setup

- [ ] 1) Run backend unit + integration tests (no external dependencies)
- [ ] 2) Run browser smoke E2E (frontend + backend local readiness)
- [ ] 3) Bring up ngrok and run webhook reachability tests
- [ ] 4) Enable Telnyx sandbox tests (`TELNYX_SANDBOX=1`)
- [ ] 5) Enable S3/MinIO integration tests
- [ ] 6) Promote selected suites into PR/nightly/weekly tiers

## 1) Baseline Snapshot (already in place)

- [x] Backend unit tests (`tests/unit`)
- [x] Backend integration tests (`tests/integration`)
- [x] Browser smoke E2E (`tests/e2e/test_smoke.py`)
- [x] Local CI orchestration script (`scripts/run-ci.ps1`)
- [x] Load harness scaffold (`tests/load/locustfile.py`)
- [x] Property-based testing present (`tests/unit/test_hypothesis.py`)
- [ ] Frontend test depth beyond smoke (`frontend/src/tests/smoke.test.ts` only)
- [ ] Clarify `tests/unit/test_auto_attendant.py` scope — no matching `app/auto_attendant` module exists; document what it covers before expanding

## 2) High-Value Test Layers to Add

### A. Live Provider Contract Tests (Telnyx + Jambonz Sandbox)

- [ ] Add real-sandbox send/receive SMS flow coverage
- [ ] Add real call lifecycle coverage (initiate, answer, end)
- [ ] Validate callback payload schema and status transitions
- [ ] Validate provider-specific error semantics and retry behavior
- [ ] Persist and verify provider event correlation IDs

### B. Adversarial Webhook Security Tests

- [ ] Invalid signature rejected (401/403)
- [ ] Missing signature header rejected
- [ ] Replayed webhook rejected (timestamp/nonce replay)
- [ ] Tampered payload rejected after signature mismatch
- [ ] Stale timestamp enforcement tested
- [ ] Oversized payload handling tested

### C. Concurrency + Idempotency Tests

- [ ] Duplicate webhook delivery processed exactly once
- [ ] Parallel state updates do not create duplicate records
- [ ] Concurrent resource creation respects unique constraints
- [ ] Retry storms do not over-increment counters
- [ ] Concurrent async flows preserve tenant/customer boundaries

### D. Resilience / Chaos Tests

- [ ] Redis outage during job enqueue/retry paths
- [ ] DB connectivity blips during write-heavy operations
- [ ] Worker restarts during active retry queue
- [ ] Provider timeout and partial failure scenarios
- [ ] Service recovery assertions (eventual consistency checks)

### E. Performance Test Expansion

- [ ] Load tests (expected sustained traffic)
- [ ] Stress tests (push until failure)
- [ ] Spike tests (sudden burst behavior)
- [ ] Soak tests (long-duration stability)
- [ ] Capacity profiling (max sustainable throughput)
- [ ] Capture and track p50/p95/p99 latency + error budget

### F. Migration + Schema Safety Tests

- [ ] Migration upgrade on clean DB
- [ ] Migration downgrade path verification
- [ ] Upgrade -> downgrade -> upgrade round-trip test
- [ ] Assert no schema drift between models and DB
- [ ] Backward-compat rolling-deploy compatibility checks

### G. Security and Multi-Tenant Isolation Tests

- [ ] Cross-customer access denied for all scoped endpoints
- [ ] Missing/malformed auth header behavior verified
- [ ] RBAC/permission boundary tests by role/scope
- [ ] Input fuzzing for key endpoints
- [ ] Log and response payloads checked for secret leakage
- [ ] Session cookie lifecycle: `POST /session` sets cookie, `DELETE /session` clears it, `GET /me` returns auth context

### H. Frontend Testing Depth (Vitest/RTL)

- [ ] Hook tests: loading/success/error transitions
- [ ] API client tests: request shape + error handling
- [ ] Component/view tests: state branches + interactions
- [ ] Skin system tests: fallback/load/switch behaviors
- [ ] Accessibility tests (axe)
- [ ] Visual regression snapshots for key pages/states

### I. Cross-Browser / Device Matrix

- [ ] Chromium + Firefox + WebKit E2E runs
- [ ] Mobile viewport smoke matrix
- [ ] Browser-specific behavior parity checks

### J. Legacy Contract Parity (VanillaLand)

- [ ] Golden request/response snapshots for compatibility endpoints
- [ ] Endpoint-by-endpoint behavioral parity checks
- [ ] Webhook and SMS payload contract parity verification

### K. Observability Tests

- [ ] Critical flows emit expected structured logs
- [ ] Key metrics emitted for request success/failure paths
- [ ] Trace/span propagation validated across async boundaries
- [ ] Alert trigger simulation for key failure modes

### L. Mutation Testing (Critical Paths)

- [ ] Enable mutation testing on high-risk business logic modules
- [ ] Track mutation score trend in CI reporting
- [ ] Add missing tests for surviving mutants

### M. Missing Module Coverage (Unit Tests)

Modules in `app/` with no test file or no checklist entry as of the initial roadmap.

- [ ] **ARQ background jobs — `call_sync.py`**: `retry_unposted_events` happy path, VanillaSoft 4xx/5xx responses, partial-failure record marking, and retry counter behavior
- [ ] **ARQ background jobs — `agent_status_sync.py`**: `poll_agent_status` logic, `_map_call_status` mapping, startup/shutdown hooks
- [ ] **Provider factory (`factory.py`)**: correct provider instantiated per `CARRIER_PROVIDER` / `CALL_ENGINE_PROVIDER` env var; unknown value raises a clear error
- [ ] **Frontend log ingestion (`vg/frontend_logs.py`)**: auth required, batch accepted, individual log levels routed correctly, oversized batch rejected
- [ ] **`parse_cors_origins` validator (`core/config.py`)**: comma-separated string, JSON array string, empty string, whitespace trimming, wildcard `*` fallback in `main.py`
- [ ] **Exception handlers (`main.py`)**: `DataError` → 422 (not 500), generic unhandled exception → 500 with no internal detail leaked
- [ ] **Prometheus metrics endpoint**: `GET /metrics` reachable and returns Prometheus text format

## 3) Suggested Rollout Tiers

### Tier 1 — PR Gate (Fast, deterministic)

- [ ] Backend unit tests (full, including Section M missing-module suite)
- [ ] Selected backend integration tests (critical path subset)
- [ ] Frontend unit/component quick suite
- [ ] E2E smoke (single browser)
- [ ] Contract/security smoke checks
- [ ] Rate-limit tests (`tests/unit/test_limiter.py`)
- [ ] Frontend log ingestion endpoint tests

### Tier 2 — Nightly (Deeper confidence)

- [ ] Full backend integration suite
- [ ] Full frontend suite
- [ ] Full cross-browser E2E matrix
- [ ] Moderate load + spike tests
- [ ] Adversarial webhook suite

### Tier 3 — Weekly (Hardening)

- [ ] Soak + capacity tests
- [ ] Chaos/resilience scenarios
- [ ] Migration round-trip + drift detection
- [ ] DAST/security deep scan
- [ ] Mutation testing report on critical modules

## 4) Operational Guardrails

- [ ] Keep PR runtime budget within team-agreed target
- [ ] Quarantine and deflake unstable tests with owner + SLA
- [ ] Publish weekly reliability report (failures, flake rate, top regressions)
- [ ] Track trend metrics: pass rate, p95 latency, mutation score, defect escape rate

## 5) Definition of Done for This Roadmap

- [ ] Each tier is wired into automation (CI schedules + PR checks)
- [ ] Failing suites produce actionable artifacts/logs
- [ ] Coverage and reliability KPIs are visible and trended
- [ ] Critical production incidents have at least one regression test added
