---
description: DB isolation rules for pytest — savepoint fixture, no raw sessions, no teardown cleanup
paths:
  - tests/**/*.py
---

# Rule: Test Isolation

## The `db_session` fixture contract

Every test that touches the database must use the `db_session` or `client` fixture
from `tests/conftest.py`. **Never** create a raw `AsyncSession` or call
`create_async_engine` inside a test.

The fixture wraps each test in a PostgreSQL transaction and rolls it back
unconditionally on teardown:

```python
await conn.begin()                         # outer transaction — never committed
async_sessionmaker(
    bind=conn,
    expire_on_commit=False,
    join_transaction_mode="create_savepoint",  # REQUIRED — see below
)
# ... yield session ...
await conn.rollback()                      # undo everything the test wrote
```

`join_transaction_mode="create_savepoint"` is **mandatory**. Without it,
`session.commit()` inside a repository commits the outer transaction for real,
so `conn.rollback()` becomes a no-op and data leaks across tests. With it, every
`session.commit()` becomes `RELEASE SAVEPOINT`, which is still visible within the
outer transaction but is fully undone by the final rollback.

## What this means when writing tests

- **Do not add teardown cleanup** (no `DELETE FROM`, no `DROP`, no fixture-level
  rollback). The `db_session` rollback handles everything.
- **Do not create a separate DB session** inside a test. Always go through
  `client` (HTTP) or `db_session` (direct ORM).
- `session.commit()` inside a repository is fine — it releases a savepoint, not
  a real commit.
- Tests that call endpoints via `client` are isolated automatically: the `client`
  fixture injects `db_session` as the `get_session` dependency override.

## Why tests must be deterministic across run modes

pytest-xdist (parallel) and pytest-testmon (single-process) produce the same
results only when every test starts with a clean database state. The savepoint
fixture is the mechanism that guarantees this. Any test that writes to the DB
outside of this fixture will make the suite order-dependent.

## Session-scoped event loop

All async tests and fixtures run on a shared session-scoped event loop
(`asyncio_mode = auto`, `loop_scope = "session"` via `pytestmark`). Do not
create new event loops inside tests. Do not use `asyncio.run()`.

## pytest markers

| Marker | Meaning | Excluded from |
| --- | --- | --- |
| `slow` | Migration round-trips and other long-running tests | Default run, PR gate |
| `chargeable` | May incur real or sandbox provider charges | Default run, PR gate, nightly |
| `sandbox` | Requires live sandbox credentials | Default run — needs `TELNYX_SANDBOX=1` |

Skipped/xfail tests must include a linked issue or a one-line reason in the marker.
Test failures are fixed in application code, not by relaxing assertions.

```python
@pytest.mark.slow
async def test_migration_round_trip(...): ...

@pytest.mark.chargeable
@pytest.mark.sandbox
async def test_provision_and_release_number(...): ...
```

## Settings mutation in tests

Tests that temporarily change `settings.*` must restore the original value
unconditionally — mutated settings persist for the lifetime of the session-scoped
event loop and will pollute subsequent tests.

Preferred: `monkeypatch` (auto-restores after the test, works in async tests):

```python
async def test_something(monkeypatch):
  monkeypatch.setattr(settings, "log_level", "DEBUG")
    ...
```

When `monkeypatch` is unavailable (module-level code): use `try/finally`:

```python
orig = settings.log_level
settings.log_level = "DEBUG"
try:
    ...
finally:
  settings.log_level = orig
```
