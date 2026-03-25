# Known Test Fixes

Quick-lookup table for recurring test failures. When a test fails with an error
matching a pattern below, apply the documented fix directly instead of reasoning
from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-tests skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| `fixture 'db_session' not found` | Test missing the async session fixture | Add `db_session` parameter to the test function signature, or ensure `conftest.py` defines it | 0 | — | 2026-03-24 |
| `RuntimeError: no running event loop` | Blocking call inside async test | Replace blocking call with its async equivalent or wrap in `asyncio.to_thread()` | 0 | — | 2026-03-24 |
| `sqlalchemy.exc.IntegrityError: duplicate key` | Test not cleaning up DB state | Add rollback in fixture teardown, or use unique generated values per test | 0 | — | 2026-03-24 |
| `httpx.ConnectError` / `Connection refused` | App container not running or not restarted after code change | Remind user to run `docker compose restart app` before re-running tests | 0 | — | 2026-03-24 |
| `AssertionError: assert 401` / `403` | Auth fixture missing or token not set | Ensure test uses the `auth_headers` fixture and passes it to the client call | 0 | — | 2026-03-24 |
| `pydantic.ValidationError` in response model | Endpoint returns fields that don't match the Pydantic schema | Update the schema in `app/schemas/` to match the actual response, or fix the endpoint return value | 0 | — | 2026-03-24 |
| `AttributeError: 'NoneType' object has no attribute` | Query returned `None` — missing seed data or wrong filter | Add the required seed row in the test fixture, or fix the query filter | 0 | — | 2026-03-24 |
| `alembic.util.exc.CommandError` | Migration head mismatch or missing migration | Run `alembic upgrade head`; if model was changed without a migration, generate one | 0 | — | 2026-03-24 |
