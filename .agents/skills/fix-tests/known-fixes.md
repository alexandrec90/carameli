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
| `test_api_contract[PUT /vsapi/1.0.0/VsExtension/Deactivate` | Path param `extension` has no constraints — schemathesis sends null bytes, PostgreSQL throws 5xx | Add `max_length=20, pattern=r"^[^\x00]*$"` to the `extension = Path(...)` in the deactivate handler | 1 | 2026-03-30 | 2026-03-30 |
| `ExceptionGroup: Hypothesis found 2 distinct failures in explicit examples` | (needs manual review) | (needs manual review) | 0 | — | 2026-03-30 |
| `coroutine '_fake_session_factory' was never awaited` | Test patches `async_session_factory` with `async def` instead of plain `def`; calling an `async def` returns a coroutine, not an async context manager | Change `async def _fake_session_factory()` to `def _fake_session_factory()` in the test | 1 | 2026-04-05 | 2026-04-05 |
| `API rejected schema-compliant request` + `country_code must be a 2-letter ISO` | `country_code` field has length constraints but no `pattern`, so schemathesis generates digit strings like `"00"` that pass length but fail the alpha-only validator | Add `pattern=r"^[A-Za-z]{2}$"` to the `country_code` `Field()` in the relevant schema class | 1 | 2026-04-05 | 2026-04-05 |
| `cannot import name 'response_schema_conformance' from 'schemathesis.checks'` | Schemathesis v4 removed `response_schema_conformance` — it's now built-in to `call_and_validate()` | Remove the import and drop `response_schema_conformance` from the `checks=[...]` list in `test_api_contract` | 1 | 2026-04-05 | 2026-04-05 |
| `assert 422 == 400` in `test_sms_send_international_number_returns_400` | SMS schema has `pattern=r"^\+1"` on `to_number`, so Pydantic rejects international numbers (422) before the handler's 400 logic runs | Remove `pattern=r"^\+1"` from `to_number` in `app/schemas/sms.py` — leave the rejection to the handler | 1 | 2026-04-05 | 2026-04-05 |
| `test_api_contract[POST /vsapi/1.0.0/PhoneLine/Add]` | Schema constraint mismatch — schemathesis generates valid-by-spec values that fail Pydantic validation, returning 422 when 200/201 expected | (needs manual review) — check `app/schemas/phone_line.py` for overly strict `pattern` or `max_length` constraints on fields used in the Add payload | 0 | — | 2026-04-06 |
| `test_api_contract[PUT /vsapi/1.0.0/PhoneLine/SetAutoAttendant]` | Schema constraint mismatch on a SetAutoAttendant field — schemathesis-generated value passes OpenAPI spec but fails Pydantic, causing unexpected 422 | (needs manual review) — check `app/schemas/phone_line.py` for field-level `pattern` or enum constraints that are stricter than the OpenAPI schema implies | 0 | — | 2026-04-06 |
