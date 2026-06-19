# Test Writing Conventions (Specialized Patterns)

Day-to-day conventions (webhook, concurrency, DB integrity, security, naming, what not to do)
live in `tests/CLAUDE.md` and are always loaded. This file covers the specialized patterns
the `make-tests` skill uses for gap categories that are less frequent.

## Contents

- [Property-based tests (hypothesis)](#property-based-tests-hypothesis)
- [Migration roundtrip tests](#migration-roundtrip-tests)
- [Config validation tests](#config-validation-tests)
- [OpenAPI snapshot tests](#openapi-snapshot-tests)
- [Performance benchmark tests](#performance-benchmark-tests)

---

## Property-based tests (hypothesis)

Use `hypothesis` for inputs with wide valid domains (phone numbers, free-text, numeric IDs).
Do not force it onto narrow enum-like inputs.

```python
from hypothesis import given, strategies as st

@given(st.from_regex(r'\+1[2-9]\d{9}', fullmatch=True))
def test_phone_number_normalization(phone: str):
    ...
```

---

## Migration roundtrip tests

```python
from alembic.config import Config
from alembic.command import upgrade, downgrade

@pytest.mark.slow
async def test_migration_001_roundtrip(tmp_alembic_cfg):
    upgrade(tmp_alembic_cfg, "001")
    downgrade(tmp_alembic_cfg, "base")
    upgrade(tmp_alembic_cfg, "001")  # re-apply must not fail
```

Place in `tests/unit/test_migrations.py`. Tag `@pytest.mark.slow`.

---

## Config validation tests

```python
def test_missing_database_url_raises(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises((ValidationError, KeyError)):
        from app.core.config import Settings
        Settings()
```

Place in `tests/unit/test_config.py`.

---

## OpenAPI snapshot tests

```python
import json
from pathlib import Path

SNAPSHOT_PATH = Path("tests/snapshots/openapi.json")

async def test_openapi_schema_snapshot(client):
    resp = await client.get("/openapi.json")
    current = resp.json()
    if not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(json.dumps(current, indent=2, sort_keys=True))
        pytest.skip("Snapshot created — commit tests/snapshots/openapi.json and re-run")
    assert current == json.loads(SNAPSHOT_PATH.read_text()), (
        "OpenAPI schema changed. Delete tests/snapshots/openapi.json to update intentionally."
    )
```

Place in `tests/integration/test_openapi_snapshot.py`. Commit the snapshot file.
Snapshot tests must not auto-update on failure.

---

## Performance benchmark tests

Use `pytest-benchmark` on hot-path endpoints only (webhook ingestion, health check,
phone line search). Do not add benchmarks for low-traffic admin endpoints.

```python
async def test_webhook_ingest_benchmark(client, benchmark):
    async def _call():
        resp = await client.post("/webhooks/jambonz/call-status", json={...})
        assert resp.status_code in (200, 201)
    benchmark.pedantic(_call, iterations=50, rounds=5)
```

Place all benchmarks in `tests/benchmark/test_benchmarks.py`.
Do not assert absolute time budgets — use `--benchmark-compare` for regression detection.
