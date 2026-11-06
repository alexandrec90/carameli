# Tests

All async tests use the session-scoped event loop:

```python
pytestmark = pytest.mark.asyncio(loop_scope="session")
```

Database tests must use `db_session` or `client` from `tests/conftest.py`. The fixture
wraps each test in an outer transaction and uses
`join_transaction_mode="create_savepoint"`, so repository commits remain visible to the
test and the final rollback removes them. Never create a separate engine/session or add
teardown deletes.

The `client` fixture overrides `get_session`, provider instances, rate-limiter storage,
and middleware. Use `AUTH_HEADERS` for authenticated API requests.

## Boundaries

- Mock only external providers/HTTP, Redis, time, or settings. Use the real service,
  repository, and PostgreSQL behavior.
- Use `AsyncMock` for async provider methods and scope patches with context managers.
- Test ARQ functions directly with their `ctx` dictionary; no worker process is needed.
- Put reusable fixtures in `conftest.py` only when at least three files need them.
- Name files `test_<module>.py` and tests `test_<thing>_<condition>`.

Every webhook family covers valid input, bad/missing signature, replay protection where
applicable, and malformed payload without a 500. Customer-scoped endpoints cover missing
and malformed auth plus cross-tenant denial. Test database constraints against the real
database.

## Cost markers

Every test requiring paid/live infrastructure carries `paid` plus its tier marker:

| Marker | Meaning |
| --- | --- |
| `sandbox` | live sandbox/read-only provider access |
| `chargeable` | buys resources or sends billable traffic |
| `live_e2e` / `manual` | real calls, SMS, recordings, or manual infrastructure |

The default `-m "not paid"` exclusion must remain the single global safety gate. Opt in
to paid tiers explicitly; never add them to `--all` or CI aggregates.

`local` is the free tier that needs this workstation: a browser and a Docker stack, with
every provider credential kept out. `addopts` deselects it and `python scripts/e2e.py`
runs it, starting everything it needs. Everything in `tests/e2e/` carries it, by a hook in
that `conftest.py`; a file elsewhere marks itself and is added to `SUITES` in the script. A
test that wants MinIO or the real stack belongs here, and a skip here is a failure. An
explicit `-m` replaces `addopts`' own, so one that means the default run spells
`not paid and not local`. `.claude/rules/local-e2e.md` is the contract.

Run the smallest relevant target, for example:

```text
pytest tests/unit/test_<module>.py
pytest tests/integration/test_contract.py
pytest -m slow
python scripts/e2e.py tests/e2e/test_smoke.py
```

Full-suite runs belong to CI or an explicit maintainer request.
