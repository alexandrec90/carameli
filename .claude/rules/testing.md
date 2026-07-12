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
| `paid` | **Umbrella** — costs money or needs paid live infra | **Everything** — `pytest.ini` sets `addopts = ... -m "not paid"` |
| `sandbox` | Paid tier 1 — live sandbox creds (`TELNYX_SANDBOX=1`), reads only | Default/CI (implies `paid`) |
| `chargeable` | Paid tier 2 — small real/sandbox charges (buys DIDs, sends SMS) | Default/CI (implies `paid`) |
| `live_e2e` / `manual` | Paid tier 3 — real infra, real money (`RUN_LIVE_E2E=1`) | Default/CI (implies `paid`) |

**The paid/free contract.** Cost is *tiered*, not flat. Every cost-incurring test carries
`paid` **plus** its tier marker; the global `-m "not paid"` in `addopts` is the one guard
that keeps all three tiers out of every default run, the `--all` aggregate, and every CI
workflow. Never add a paid test to `run-tests.py`'s `_ALL_TARGETS`, and never remove the
`-m "not paid"` default without an equivalent guard — an automated pipeline must never hit
a live provider. Opt in explicitly per tier (`-m sandbox`, `-m chargeable`,
`RUN_LIVE_E2E=1 ... -m paid`).

**Recurring-cost cleanup (mandatory for `chargeable`).** A provisioned Telnyx DID is a
*recurring monthly* charge from the moment it is ordered — not a one-off. Any test that
provisions a number (or any other billable, persisted provider resource) must release it
in a `finally`, with the resource id resolved **before** the first assertion, so an
assertion failure or a flaky release can never leak the resource into a monthly bill.
Never place an `assert` between the order and the release outside the `try`. This is the
only place in the suite that buys a recurring resource; keep it that way — reuse the
pre-owned `TELNYX_TEST_*` / `E2E_DID_*` numbers for send/receive tests rather than
provisioning new ones.

Skipped/xfail tests must include a linked issue or a one-line reason in the marker.
Test failures are fixed in application code, not by relaxing assertions.

```python
@pytest.mark.slow
async def test_migration_round_trip(...): ...

# Tier 2: carries `paid` (module pytestmark), `sandbox`, and `chargeable`.
@pytest.mark.chargeable
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
