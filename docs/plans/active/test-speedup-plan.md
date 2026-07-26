# Test suite speedup — remaining work

Follow-up plan for test suite performance work. Tracks the larger-refactor and
situational items that were scoped out of the initial pass.

## Context

The initial pass (see commit history on `scripts/run-tests.ps1`, `pytest.ini`,
`tests/conftest.py`, `tests/integration/test_contract.py`) applied:

1. `pytest-timeout` with `timeout = 60` + `timeout_method = signal`.
2. Module-scoped engine with `NullPool` in `_contract_env` (replaces per-request
   engine churn in schemathesis tests).
3. `--durations=20` on every pytest invocation.
4. Hypothesis `max_examples`: 20 → 10 in `test_contract.py`.
5. `--dist=worksteal` on xdist invocations.
6. TRUNCATE + schema-fingerprint fast path in `test_engine` (replaces
   unconditional DROP+CREATE+create_all at session start).
7. Fast-mode collect consolidated into one `docker compose exec` call.

This document covers four items that were deferred because each is either a
non-trivial refactor, has a non-obvious correctness risk, or needs profiling
data to justify.

---

## 1. Session-scoped `client` fixture with per-test savepoint

### Goal

Eliminate per-test ASGI middleware rebuild, rate-limiter swap, and `app.state`
mock setup. Expected saving: ~20-50ms per test × hundreds of tests.

### Current state

[tests/conftest.py:101-135](../../../tests/conftest.py#L101-L135) — the `client`
fixture is function-scoped. Every test pays the full cost of:

- Setting `app.state.carrier = MagicMock()` and `app.state.engine = MagicMock()`.
- Swapping `rate_limiter._storage` and `rate_limiter._limiter` to an in-memory
  backend and restoring after.
- Removing `SlowAPIMiddleware` from `app.user_middleware`, rebuilding
  `app.middleware_stack`, and restoring after.
- Creating a fresh `AsyncClient` with `ASGITransport`.

All of this is setup cost that produces the same result every test.

### Proposed change

Split responsibilities:

- **Session-scoped** `_app_configured` fixture: does the middleware swap, the
  rate-limiter storage swap, and sets baseline `MagicMock` on `app.state`. Runs
  once at session start, restores at session end.
- **Function-scoped** `client` fixture: builds the `AsyncClient`, injects the
  per-test `db_session` as the `get_session` override. Resets
  `app.state.carrier.reset_mock()` / `app.state.engine.reset_mock()` per test
  so mock call history doesn't bleed between tests.

Keep the per-test savepoint isolation via `db_session`.

### Risk (high-ish — this is why it's not in the first pass)

- **`MagicMock` call history across tests**: any test that does
  `app.state.carrier.search_numbers.assert_called_once_with(...)` must be
  examined. If more than a handful exist, switch to reset_mock on every fixture
  yield. Audit first.
- **Test-level mutations to `app.state`**: some tests replace
  `app.state.carrier.search_numbers = AsyncMock(...)`. The session-scoped
  fixture must store the original mock references so per-test mutations can be
  restored, or we leak mock state across tests.
- **Rate-limiter state between tests**: an in-memory limiter accumulates counts
  across tests in the same session. Reset the storage per test, or use a
  `memory://` URL that builds a fresh limiter per test. Without this, rate-
  limit tests become order-dependent.
- **ASGI lifespan events**: `AsyncClient(transport=ASGITransport(app=app))`
  currently runs lifespan once per client. Session-scoped means lifespan runs
  once per session. Any test that depends on lifespan side effects (startup
  hooks creating resources) needs a closer look.

### Validation

1. Run `pytest -p no:cacheprovider --randomly-seed=1 tests/unit tests/integration`
   twice with the same seed; result set must be identical.
2. Grep for `assert_called`, `call_count`, `reset_mock`, `app.state.carrier =`,
   `app.state.engine =` across `tests/` and audit every hit.
3. Run with `-x --stepwise-skip` on a known-failing case to make sure failure
   isolation still works.
4. Compare wall-clock time on the full suite before and after. Must be
   measurably faster (expected: 5-15% on the unit suite).

### Effort

1-2 focused sessions. Bulk of time is the audit in step 2 — cannot be skipped.

---

## 2. Pre-materialized test DB via PostgreSQL templates

### Goal (2)

Eliminate the advisory-lock dance and `create_all` coordination across xdist
workers. Each worker gets its own private test database cloned from a prepared
template in near-constant time (`CREATE DATABASE ... TEMPLATE ...` is O(size)
but typically 100-500ms even for nontrivial schemas).

### Current state (2)

All xdist workers share one PostgreSQL database. Coordination is via
`pg_advisory_xact_lock(7654321987)`, with the primary worker (`gw0` / `master`)
responsible for schema reset and non-primaries running `create_all` as no-ops.
The fingerprint fast path (item #6 of the initial pass) already takes the
session-start reset from ~1-3s to ~100ms, so this work is now lower priority.

### Proposed change (2)

1. **Template creation (one-time, in container build or a `pytest_configure`
   hook):** connect to `postgres` DB, `CREATE DATABASE carameli_test_template`,
   run `Base.metadata.create_all` against it, then `ALTER DATABASE
   carameli_test_template IS_TEMPLATE true`.
2. **Per-worker DB:** in `test_engine`, read `PYTEST_XDIST_WORKER`, compute
   `carameli_test_${worker_id}`. `CREATE DATABASE carameli_test_gw0 TEMPLATE
   carameli_test_template` (idempotent — `IF NOT EXISTS` pattern via catalog
   check).
3. **Reset between runs:** DROP the worker DB at session end (or at session
   start of the next run, to preserve logs from crashed runs).
4. **Keep fingerprint mechanism:** stamp the fingerprint on the *template*. If
   it drifts, drop and rebuild the template. Workers always start clean from
   the template.

### Risk

- **Template connection restriction**: Postgres refuses `CREATE DATABASE ...
  TEMPLATE x` if *any* connection is open to `x`. The template-creation path
  must disconnect before workers try to clone. Not hard, but a footgun.
- **Privileges**: the test DB role needs `CREATEDB`. Currently it's the app
  user. Verify against `scripts/db-init.sh` (or wherever roles are defined).
- **Settings propagation**: `settings.database_url` is a single URL today.
  Workers need per-worker URLs. Either: override via env var set by xdist, or
  compute the worker DB name inside `test_engine` and rewrite the URL.
- **Crashed-run cleanup**: stale worker DBs (`carameli_test_gw17` etc.) will
  accumulate. Add a startup pass that drops any `carameli_test_*` databases
  older than N hours, or drop-if-exists before create.
- **Interaction with `_contract_env`**: schemathesis' sync portal runs on
  different event loops; it connects via `settings.database_url`. The per-
  worker URL rewrite must land before `_contract_env` reads settings.

### Validation (2)

1. Run `pytest -n 4` and confirm no `pg_advisory_xact_lock` calls appear in
   `pg_stat_activity` during test setup.
2. Kill a worker mid-test, start a new run, confirm the new run does not error
   on the stale DB.
3. Drop the template, run the suite, confirm it recreates the template on its
   own.
4. Measure: session-start coordination time (currently ~100ms on fingerprint
   fast path) should drop to sub-50ms per worker, with true parallelism on
   setup.

### Effort (2)

2-3 sessions. Most of the work is in worker-URL plumbing and template lifecycle
scripting, not the core fixture change. Lower ROI now that #6 of the initial
pass is in — defer unless xdist setup contention becomes the bottleneck.

---

## 3. Revisit `prepared_statement_cache_size: 0`

### Goal (3)

Let asyncpg cache prepared statements across requests. Could save 1-5ms per
query × many queries per test. Small per-test, meaningful over thousands.

### Current state (3)

[tests/conftest.py:40](../../../tests/conftest.py#L40) and
[tests/integration/test_contract.py:74](../../../tests/integration/test_contract.py#L74)
both pass `connect_args={"prepared_statement_cache_size": 0}` to
`create_async_engine`. This disables asyncpg's prepared-statement cache
entirely.

Disabling the cache is standard behind PgBouncer in *transaction-pooling mode*,
where a single asyncpg connection can be multiplexed across multiple backend
sessions and prepared statements from one session are invisible in the next.
The question is whether that situation applies here.

### Proposed change (3)

1. Audit: does test traffic go through PgBouncer? Check `docker-compose.yml`
   for a pgbouncer service and `settings.database_url`'s host/port.
2. If PgBouncer is session-mode (or absent): drop `prepared_statement_cache_size=0`
   entirely — default asyncpg cache size of 100 kicks in.
3. If PgBouncer is transaction-mode: leave it alone (the current setting is
   correct). Instead explore `statement_cache_size=0, prepared_statement_name_func=...`
   patterns that work under transaction pooling.
4. If unclear: set up one test run with the cache enabled and watch for
   `prepared statement "..." does not exist` errors. Those indicate transaction
   pooling is active.

### Risk (3)

- Low, but non-zero: if transaction pooling is active and the cache is
  re-enabled, every test that reuses a connection from the pool will fail with
  a prepared-statement error. Fails loudly though — not a silent correctness
  bug.

### Validation (3)

1. Remove the setting locally, run the suite, confirm no `PreparedStatement` or
   `DuplicatePreparedStatementError` traces.
2. Benchmark with `--durations=20` before and after; compare the top 20.
3. If measurable win (>2%), keep. If not, revert.

### Effort (3)

0.5 session. Mostly investigation, small change, easy to revert.

---

## 4. Mark and exclude truly slow tests by default

### Goal (4)

Keep the inner-loop test run fast. Anything taking >1s is a productivity tax on
every local run and every CI invocation; move it to a nightly tier.

### Current state (4)

`pytest.ini` already defines the `slow` / `chargeable` / `sandbox` markers and
excludes tests with those markers from the default run via their unignored-dir
placement. But the markers are only applied to migration round-trip tests
([tests/unit/test_migration_concerns.py](../../../tests/unit/test_migration_concerns.py))
and sandbox tests. There is no systematic audit of which non-marked tests are
actually slow.

The `--durations=20` output added in the initial pass is the mechanism to
produce that audit data. It just hasn't been acted on yet.

### Proposed change (4)

1. Run the full suite 3× and collect `--durations=20` output.
2. Any test consistently >1s that is not architecturally required in the inner
   loop: mark with `@pytest.mark.slow` and document why in a one-line comment.
3. Add a new marker `@pytest.mark.integration_heavy` for integration tests
   that hit the DB through multi-step flows but don't need to run on every
   save (e.g. full contract fuzz + resilience scenarios).
4. Extend `pytest.ini` `addopts` with `-m "not integration_heavy"` so these
   only run on explicit `pytest -m integration_heavy` or in CI nightly.
5. Add a CI job that runs the slow + integration_heavy + sandbox markers on a
   schedule.

### Risk (4)

- **Missing a regression class**: a bug that only manifests in a slow test now
  ships to main silently if the nightly job isn't watched. Mitigate: the
  nightly CI job fails loudly (email/Slack), and the PR gate still runs the
  default suite.
- **Marker drift**: tests get marked slow, then the slow suite is never run.
  Mitigate: a scheduled run with retention on failures.

### Validation (4)

1. Before: record total wall-clock of default `pytest` run.
2. After: record again. Must be meaningfully faster (expect 20-40% reduction
   if contract + schema migration tests get marked).
3. Run the slow suite (`pytest -m "slow or integration_heavy or chargeable"`)
   and confirm it covers the now-excluded tests.
4. Confirm CI configuration runs both suites — default on every push, slow
   nightly.

### Effort (4)

0.5-1 session for the audit + marking; infrastructure (CI job for slow suite)
is separate work depending on CI provider.

---

## Recommended order

1. **#4** (mark slow tests) — highest ROI, least risk. Do after the first
   post-speedup-pass suite run so we have real `--durations` data.
2. **#3** (revisit statement cache) — cheap, quick to validate, small
   speedup if it works.
3. **#1** (session-scoped client fixture) — measurable speedup, but the mock-
   state audit is the real cost. Worth doing once the quick wins are in.
4. **#2** (PostgreSQL templates) — defer unless xdist setup coordination
   becomes the bottleneck again. The fingerprint fast path already dropped
   per-run setup from ~1-3s to ~100ms, which may be enough.
