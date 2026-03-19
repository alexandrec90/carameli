---
name: make-tests
description: 'Generate missing tests or review existing tests and fill gaps. Covers unit, integration, property-based, adversarial webhook, concurrency, DB integrity, migration, config validation, security, snapshot, and performance benchmark tests.'
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

For each gap identified, append or create tests following these conventions:

### Fixture and async conventions

```python
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_example(client: AsyncClient):
    ...
```

### Mock at the provider boundary — never mock SDK internals

```python
# CORRECT — mock the CarrierProvider interface
with patch("app.services.did_manager.carrier") as mock_carrier:
    mock_carrier.send_sms = AsyncMock(return_value={"sid": "SM123"})

# WRONG — never do this
with patch("telnyx.Message.create") as mock:
    ...
```

### Adversarial webhook tests

Every webhook test file must include:

1. **Happy path** — valid signature, correct payload
2. **Bad signature** — should return 401
3. **Missing signature header** — should return 401
4. **Replayed timestamp** (if the webhook validates timestamp age) — should return 401
5. **Malformed payload** — should return 422 or 400, not 500

### Property-based tests (hypothesis)

Use `hypothesis` for inputs with wide valid domains:

```python
from hypothesis import given, strategies as st

@given(st.from_regex(r'\+1[2-9]\d{9}', fullmatch=True))
def test_phone_number_normalization(phone: str):
    ...
```

Only add hypothesis tests where the input space is genuinely large and
varied (phone numbers, free-text fields, numeric IDs). Do not force it
onto narrow enum-like inputs.

### Concurrency / race-condition tests

Use `asyncio.gather` to fire competing requests and assert the outcome is
safe (no duplicates, no 500s, correct final state):

```python
import asyncio

@pytest.mark.asyncio
async def test_concurrent_pointer_add_is_idempotent(client: AsyncClient, db_session):
    # ... setup customer, phone_line, extension ...
    payload = {
        "vs_customer_id": 9001,
        "phone_number": "+14155559001",
        "extension_number": "101",
    }
    results = await asyncio.gather(
        client.post("/vsapi/1.0.0/AddPointerToExtension", json=payload, headers=AUTH_HEADERS),
        client.post("/vsapi/1.0.0/AddPointerToExtension", json=payload, headers=AUTH_HEADERS),
    )
    statuses = sorted(r.status_code for r in results)
    # Both succeed (idempotent) or one succeeds and the other gets 409
    assert statuses[0] == 200
    assert statuses[1] in (200, 409)
    # Verify exactly one row exists
    ...
```

Place concurrency tests in the same unit test file as the module they exercise.
Tag with a comment `# concurrency` so they are easy to find.

### DB integrity tests

Test FK constraints and unique constraints at the repository layer.
These tests hit the real database (via the `db_session` fixture) — do not mock.

```python
import pytest
from sqlalchemy.exc import IntegrityError

@pytest.mark.asyncio
async def test_phone_line_fk_rejects_nonexistent_customer(db_session):
    repo = PhoneLineRepo(db_session)
    with pytest.raises(IntegrityError):
        await repo.create(
            customer_id=uuid.uuid4(),  # does not exist
            phone_number="+14155550000",
            provider_sid="PNorphan",
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_delete_customer_with_phone_lines_raises(db_session):
    """Default FK RESTRICT prevents parent deletion when children exist."""
    # ... create customer, then create a phone_line for that customer ...
    with pytest.raises(IntegrityError):
        await db_session.delete(customer)
        await db_session.flush()
```

Place DB integrity tests in `tests/unit/test_db_integrity.py`.

### Migration roundtrip tests

Test that each Alembic migration applies and reverses cleanly.

```python
from alembic.config import Config
from alembic.command import upgrade, downgrade

@pytest.mark.asyncio
async def test_migration_001_roundtrip(tmp_alembic_cfg):
    upgrade(tmp_alembic_cfg, "001")
    downgrade(tmp_alembic_cfg, "base")
    upgrade(tmp_alembic_cfg, "001")  # re-apply must not fail
```

Place migration tests in `tests/unit/test_migrations.py`.
Use a dedicated test database or the existing `test_engine` fixture.

### Config validation tests

Test `app/core/config.py` `Settings` class with overridden env vars.
Use `monkeypatch` to set or unset environment variables:

```python
def test_missing_database_url_raises(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises((ValidationError, KeyError)):
        from app.core.config import Settings
        Settings()


def test_invalid_rate_limit_format_raises(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT", "not-a-valid-limit")
    with pytest.raises(ValidationError):
        Settings()
```

Place config tests in `tests/unit/test_config.py`.

### Security / tenant isolation tests

For any customer-scoped endpoint, verify that a token for customer A
cannot access customer B's data:

```python
@pytest.mark.asyncio
async def test_customer_token_cannot_read_other_customer(client):
    # Create customer A and customer B
    # Use customer A's token
    # Try to read customer B's phone lines → expect 403 or empty result
    ...
```

Also test:

- Missing `Authorization` header → 401 (not 500)
- Malformed bearer token → 401
- Oversized request body → 413 or 422

Place security tests in `tests/unit/test_security.py`.

### OpenAPI snapshot tests

Pin the API contract so accidental breaking changes are caught:

```python
import json
from pathlib import Path

SNAPSHOT_PATH = Path("tests/snapshots/openapi.json")

@pytest.mark.asyncio
async def test_openapi_schema_snapshot(client: AsyncClient):
    resp = await client.get("/openapi.json")
    assert resp.status_code == 200
    current = resp.json()

    if not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(json.dumps(current, indent=2, sort_keys=True))
        pytest.skip("Snapshot created — commit tests/snapshots/openapi.json and re-run")

    baseline = json.loads(SNAPSHOT_PATH.read_text())
    assert current == baseline, (
        "OpenAPI schema changed. If intentional, delete tests/snapshots/openapi.json and re-run to update."
    )
```

Place in `tests/integration/test_openapi_snapshot.py`.
The snapshot file `tests/snapshots/openapi.json` must be committed to git.

### Performance benchmark tests

Use `pytest-benchmark` to assert response-time budgets on hot-path
endpoints. Benchmarks use the same `client` fixture as unit tests.

```python
import pytest

@pytest.mark.asyncio
async def test_health_check_benchmark(client, benchmark):
    async def _call():
        resp = await client.get("/health")
        assert resp.status_code == 200

    benchmark.pedantic(_call, iterations=50, rounds=5)


@pytest.mark.asyncio
async def test_webhook_ingest_benchmark(client, benchmark):
    async def _call():
        resp = await client.post(
            "/webhooks/jambonz/call-status",
            json={"call_sid": "CA_bench", "status": "completed", ...},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code in (200, 201)

    benchmark.pedantic(_call, iterations=50, rounds=5)
```

Place all benchmarks in `tests/benchmark/test_benchmarks.py`.
Do not mix benchmarks into unit test files — benchmark runs are opt-in
(`pytest tests/benchmark/`) and should not slow down the main test suite.

**Time budgets are informational, not assertions.** Do not add
`assert benchmark.stats["mean"] < X` — pytest-benchmark tracks
regressions across runs via `--benchmark-compare`. The goal is to
detect regressions, not enforce absolute thresholds.

### Naming conventions

- File: `tests/unit/test_<module_name>.py` (standard unit tests)
- File: `tests/unit/test_db_integrity.py` (all FK / constraint tests)
- File: `tests/unit/test_migrations.py` (Alembic roundtrip tests)
- File: `tests/unit/test_config.py` (config validation tests)
- File: `tests/unit/test_security.py` (tenant isolation and auth edge cases)
- File: `tests/integration/test_openapi_snapshot.py` (schema snapshot)
- File: `tests/benchmark/test_benchmarks.py` (performance benchmarks)
- Function: `test_<thing_being_tested>_<condition>` e.g. `test_send_sms_carrier_error`
- Concurrency tests: keep in the relevant module's test file, tagged with `# concurrency`

### What NOT to do

- Do not import from `telnyx`, `jambonz`, or any third-party SDK directly in tests
- Do not add fixtures to `conftest.py` unless they are reused across 3+ test files
- Do not test framework behavior (FastAPI validation, SQLAlchemy session handling) —
  **exception**: DB integrity tests may assert `IntegrityError` for FK/unique constraints
  since those are project-defined schema rules, not generic ORM behavior
- Do not write tests for code you have not read
- Do not generate migration roundtrip tests for migration files that have no `op.*` calls

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
