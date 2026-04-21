---
name: make-tests
description: 'Generates or audits pytest tests: unit, integration, property-based, webhook, concurrency, DB integrity, migration, config, security, snapshot, and benchmark. Use when adding backend modules, fixing bugs, or reviewing test coverage.'
argument-hint: 'Optional: a file or module path to target (e.g., "app/api/vsapi/sms.py"), or "review" to audit existing tests for gaps only'
---

# Skill: Make Tests

Write new tests or review existing tests and add what is missing.
Always follows project conventions: pytest-asyncio, mocks at the
CarrierProvider / CallEngineProvider boundary, never mocks internal SDK details.

---

## Step 1 — Determine Mode

| Argument | Mode |
| --- | --- |
| No argument | **Full audit** — scan all source modules, identify gaps, generate tests |
| `review` | **Review only** — report gaps without writing files |
| A file/module path | **Targeted** — generate tests for that module only |

---

## Step 2 — Load State

Read `.claude/skills/make-tests/state.json`. It tracks which modules have been
covered and when. Each entry:

```json
{
  "module": "app/api/vsapi/sms.py",
  "test_file": "tests/unit/test_sms.py",
  "last_reviewed": "YYYY-MM-DD",
  "git_hash": "<sha of module at review time>",
  "gaps_found": 0
}
```

If the file does not exist, treat it as `{ "last_run": null, "modules": [] }`.

---

## Step 3 — Discover Source Modules

Find all first-party Python source files **and** migration files
(skip tests, `__pycache__`, venv):

```bash
find app alembic/versions -name "*.py" \
  -not -path "*/__pycache__/*" \
  -not -name "conftest.py" \
  | sort
```

Also discover infrastructure modules that need dedicated test categories:

```bash
# Config module (config validation tests)
echo app/core/config.py

# Migration files (migration roundtrip tests)
find alembic/versions -name "*.py" -not -name "__*" | sort
```

For each module, get its current last-commit hash:

```bash
git log --format="%H" -1 -- <filepath>
```

Triage:

| Status | Condition | Action |
| --- | --- | --- |
| **SKIP** | In state.json, hash matches, gaps_found = 0 | Skip |
| **SKIP** | No git commit yet (`git log -1 -- <file>` returns empty) and not explicitly targeted | Skip — file was just created this session; tests will be requested separately |
| **CHANGED** | In state.json but hash differs | Re-evaluate |
| **NEW** | Not in state.json and has at least one commit | Full pass |

In **targeted** mode, the session-skip rule is bypassed — always process the specified module.

---

## Step 4 — Audit Each Module

For each module to process:

**4a. Read the source file.** Identify:

- Every route handler, service method, and repository method
- Edge cases: missing records (404), invalid input, auth failure, provider errors
- Webhook handlers: happy path, bad signature, replayed request, tampered payload
- Async paths that could raise or return `None`

**4b. Read the existing test file** (if it exists). Map what is already covered.

**4c. Identify gaps.** A gap is any of:

**Standard gaps (existing):**

- An untested route handler or method
- A missing error/edge case (404, 422, 500, auth rejection)
- Adversarial webhook cases (bad HMAC, missing signature header, replayed timestamp)
- No property-based test where inputs have a wide valid range (phone numbers, rate limits, pagination)
- Provider error path not tested (carrier raises, engine raises)

**Concurrency gaps** — check for any endpoint or repo method where two
concurrent requests could race (e.g. duplicate creation, double-spend of a
resource). Look for:

- Upsert operations (pointer add, SCI rule post)
- Resource creation that should be idempotent (customer create with same vs_customer_id)
- Webhook handlers that may receive the same event simultaneously

**DB integrity gaps** — for each model with `ForeignKey` columns, check
whether the test suite verifies:

- FK constraint enforcement (insert a child row with a non-existent parent → `IntegrityError`)
- Unique constraint enforcement where `UniqueConstraint` is declared
- Cascade / restrict behavior on parent deletion (Carameli uses default RESTRICT — deleting a customer with phone lines should fail, not silently cascade)

**Migration gaps** — for each `alembic/versions/*.py` file, check whether:

- `upgrade()` applies cleanly on an empty database
- `downgrade()` reverses cleanly back to the prior revision
- The migration is not empty (has at least one `op.*` call)
- Round-trip: upgrade → downgrade → upgrade produces no diff

**Config validation gaps** — for `app/core/config.py`, check whether:

- Missing required env vars raise a clear error at startup
- Invalid values (e.g. malformed `DATABASE_URL`, non-numeric `RATE_LIMIT`) are rejected
- Default values are applied when optional vars are absent

**Security / tenant isolation gaps** — for any endpoint that accepts a
`vs_customer_id` or customer-scoped token, check whether:

- A valid token for customer A cannot read/modify customer B's resources
- Requests without `Authorization` header return 401, not 500
- Oversized payloads are rejected (not silently truncated)

**ARQ background job gaps** — for `app/services/call_sync.py` and
`app/services/agent_status_sync.py`, check whether:

- Each job function is tested by calling it directly with a mock `ctx` dict (no ARQ
  infrastructure needed — they are plain async functions)
- `retry_unposted_events`: no-URL early return, VanillaSoft 2xx marks event posted,
  VanillaSoft non-2xx leaves event unposted, non-terminal status skipped, httpx error swallowed
- `poll_agent_status`: no-engine-in-ctx early return, engine exception swallowed and logged,
  happy-path upsert writes correct `call_state` and `sip_registered` values
- Lifecycle hooks: `startup` stores provider on `ctx["engine"]`, `shutdown` calls `aclose`

**Observability / log assertion gaps** — for any handler or service with documented log
events in `.claude/rules/logging-backend.md`, check whether:

- INFO log on successful mutation contains the key identifiers (customer ID, SID, number)
- WARNING or ERROR log fires on provider failure
- No secrets (API keys, bearer tokens, webhook secrets) appear in any log message

Use `caplog.at_level(logging.INFO, logger="app.module.name")` scoped to the module under test.
Scope narrowly — `caplog.at_level(logging.DEBUG)` without a logger arg captures too much noise.

**Snapshot gaps** — check whether the OpenAPI schema is pinned. If no
golden-file test exists for the schema, flag it. A snapshot test calls
`GET /openapi.json` and compares against a checked-in baseline; any diff
means the API contract changed and must be reviewed.

**Performance benchmark gaps** — for route handlers that are on the hot
path (webhook ingestion, SMS send, phone line search, health check), check
whether a `pytest-benchmark` test exists. A benchmark test calls the
endpoint repeatedly and asserts a time budget. Look for:

- Webhook ingestion (`POST /webhooks/jambonz/call-status`) — high-volume, latency-sensitive
- Health check (`GET /health`) — polled frequently by load balancers
- Phone line search/list endpoints — may do DB queries with filters
- Any endpoint the Locust load test already exercises (cross-reference `tests/load/locustfile.py`)

Only flag a benchmark gap when the endpoint is called at high frequency or
is latency-sensitive. Do not add benchmarks for low-traffic admin endpoints
(customer create, extension create, SCI rule post).

Output a gap list before writing anything:

```text
Module: app/api/vsapi/sms.py  →  tests/unit/test_sms.py
  GAP: POST /VsMessaging/Sms/Send — missing test for carrier.send_sms raising CarrierError
  GAP: POST /VsMessaging/Sms/Send — no property-based test for phone number formats
  GAP: webhook bad-signature case not covered
  GAP [concurrency]: POST /VsMessaging/Sms/Enable — no concurrent-enable race test
  GAP [db-integrity]: PhoneLine FK to customers.id — no constraint violation test
  GAP [security]: GET /VsMessaging/Sms/ — no cross-customer isolation test
  GAP [benchmark]: POST /webhooks/jambonz/call-status — no performance benchmark
```

In **review** mode, stop here and print the full gap report. Do not write files.

---

## Step 5 — Write Tests

For each gap identified, append or create tests following the patterns in
[writing-conventions.md](writing-conventions.md). That file covers:

- Fixture and async conventions
- Mock boundary rules (CarrierProvider / CallEngineProvider only, never SDK internals)
- Adversarial webhook tests (bad signature, missing header, replayed timestamp, malformed payload)
- Property-based tests (hypothesis) for wide-domain inputs
- Concurrency / race-condition tests (`asyncio.gather`)
- DB integrity tests (FK constraints, unique constraints — use real DB, no mocks)
- Migration roundtrip tests (upgrade → downgrade → upgrade)
- Config validation tests (`monkeypatch` env vars)
- Security / tenant isolation tests (cross-customer access, missing auth header)
- OpenAPI snapshot tests (golden-file comparison)
- Performance benchmark tests (`pytest-benchmark`, hot-path endpoints only)
- Naming conventions and what NOT to do

---

## Step 6 — Update State

After processing each module, update `.claude/skills/make-tests/state.json`:

- Set `last_reviewed` to today's date
- Set `git_hash` to the current hash of the source module
- Set `gaps_found` to the number of gaps discovered this run (0 if none)
- Set `last_run` on the root object to today's date

---

## Step 7 — Report

Print a summary table:

```text
## Test Coverage Pass — YYYY-MM-DD

| Module | Test File | Gaps Found | Tests Added |
|--------|-----------|-----------|-------------|
| app/api/vsapi/sms.py | tests/unit/test_sms.py | 3 | 3 |
| app/services/call_control.py | tests/unit/test_calls.py | 1 | 1 |
| app/api/webhooks/call_status.py | tests/unit/test_webhooks.py | 5 | 5 |
| (cross-cutting) | tests/unit/test_db_integrity.py | 4 | 4 |
| (cross-cutting) | tests/unit/test_security.py | 3 | 3 |
| alembic/versions/001_*.py | tests/unit/test_migrations.py | 1 | 1 |
| app/core/config.py | tests/unit/test_config.py | 2 | 2 |
| (cross-cutting) | tests/integration/test_openapi_snapshot.py | 1 | 1 |
| (hot-path) | tests/benchmark/test_benchmarks.py | 2 | 2 |

Total: X gaps found, Y tests added.
```

### Gap category breakdown

After the module table, print a breakdown by gap type:

```text
| Category | Gaps |
|----------|------|
| Standard (unit/error/property) | N |
| Adversarial webhook | N |
| Concurrency | N |
| DB integrity | N |
| Migration roundtrip | N |
| Config validation | N |
| Security / isolation | N |
| ARQ background jobs | N |
| Observability / log assertions | N |
| Snapshot | N |
| Performance benchmark | N |
```

List any modules skipped (unchanged since last pass).
Note any test failures that were not resolved.

---

## Hard Rules

1. Mock only at the `CarrierProvider` / `CallEngineProvider` boundary — never mock SDK internals.
2. One module at a time — complete audit → write before moving on. Cross-cutting test files (`test_db_integrity.py`, `test_security.py`, `test_migrations.py`, `test_config.py`, `test_openapi_snapshot.py`) are written after all module passes complete.
3. Never modify source files. If a gap requires a source change, report it instead.
4. Do not add tests for framework or third-party behavior — **exception**: DB integrity tests may assert `IntegrityError` for project-defined FK/unique constraints, and migration tests may call Alembic `upgrade`/`downgrade`.
5. In **review** mode, never write or modify any file.
6. Never add a `conftest.py` fixture unless it will be used by 3+ test files.
7. Concurrency tests must not rely on timing — use `asyncio.gather`, not `asyncio.sleep` with interleaving.
8. Snapshot tests must not auto-update on failure — require manual deletion of the baseline file to force an intentional update.
