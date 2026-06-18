# Test Writing Conventions

## Contents

- [Fixture and async conventions](#fixture-and-async-conventions)
- [Mock at the provider boundary](#mock-at-the-provider-boundary--never-mock-sdk-internals)
- [Adversarial webhook tests](#adversarial-webhook-tests)
- [Property-based tests (hypothesis)](#property-based-tests-hypothesis)
- [Concurrency / race-condition tests](#concurrency--race-condition-tests)
- [DB integrity tests](#db-integrity-tests)
- [Migration roundtrip tests](#migration-roundtrip-tests)
- [Config validation tests](#config-validation-tests)
- [Security / tenant isolation tests](#security--tenant-isolation-tests)
- [OpenAPI snapshot tests](#openapi-snapshot-tests)
- [Performance benchmark tests](#performance-benchmark-tests)
- [Naming conventions](#naming-conventions)
- [What NOT to do](#what-not-to-do)

---

## Fixture and async conventions

```python
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_example(client: AsyncClient):
    ...
```

## Mock at the provider boundary — never mock SDK internals

```python
# CORRECT — mock the CarrierProvider interface
with patch("app.services.did_manager.carrier") as mock_carrier:
    mock_carrier.send_sms = AsyncMock(return_value={"sid": "SM123"})

# WRONG — never do this
with patch("telnyx.Message.create") as mock:
    ...
```

## Adversarial webhook tests

Every webhook test file must include:

1. **Happy path** — valid signature, correct payload
2. **Bad signature** — should return 401
3. **Missing signature header** — should return 401
4. **Replayed timestamp** (if the webhook validates timestamp age) — should return 401
5. **Malformed payload** — should return 422 or 400, not 500

## Property-based tests (hypothesis)

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

## Concurrency / race-condition tests

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

## DB integrity tests

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

## Migration roundtrip tests

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

## Config validation tests

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

## Security / tenant isolation tests

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

## OpenAPI snapshot tests

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

## Performance benchmark tests

Use `pytest-benchmark` to assert response-time budgets on hot-path endpoints.
Benchmarks use the same `client` fixture as unit tests.

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
`assert benchmark.stats["mean"] < X` — pytest-benchmark tracks regressions
across runs via `--benchmark-compare`. The goal is to detect regressions,
not enforce absolute thresholds.

## Naming conventions

- File: `tests/unit/test_<module_name>.py` (standard unit tests)
- File: `tests/unit/test_db_integrity.py` (all FK / constraint tests)
- File: `tests/unit/test_migrations.py` (Alembic roundtrip tests)
- File: `tests/unit/test_config.py` (config validation tests)
- File: `tests/unit/test_security.py` (tenant isolation and auth edge cases)
- File: `tests/integration/test_openapi_snapshot.py` (schema snapshot)
- File: `tests/benchmark/test_benchmarks.py` (performance benchmarks)
- Function: `test_<thing_being_tested>_<condition>` e.g. `test_send_sms_carrier_error`
- Concurrency tests: keep in the relevant module's test file, tagged with `# concurrency`

## What NOT to do

- Do not import from `telnyx`, `jambonz`, or any third-party SDK directly in tests
- Do not add fixtures to `conftest.py` unless they are reused across 3+ test files
- Do not test framework behavior (FastAPI validation, SQLAlchemy session handling) —
  **exception**: DB integrity tests may assert `IntegrityError` for FK/unique constraints
  since those are project-defined schema rules, not generic ORM behavior
- Do not write tests for code you have not read
- Do not generate migration roundtrip tests for migration files that have no `op.*` calls
