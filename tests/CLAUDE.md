# Tests

## Async Event Loop

All tests share a **session-scoped** async event loop (`asyncio_mode = auto` in `pytest.ini`).
Every test file should have:

```python
pytestmark = pytest.mark.asyncio(loop_scope="session")
```

This keeps the PostgreSQL connection pool valid across tests within a session.

## The `client` Fixture

The global `client` fixture (`conftest.py`) builds an `AsyncClient` over the ASGI app with these overrides:

| Override | Why |
| --- | --- |
| `get_session` dependency | Uses the rollback-wrapped `db_session` |
| `app.state.carrier` | `MagicMock()` -- no real Telnyx calls |
| `app.state.engine` | `MagicMock()` -- no real Jambonz calls |
| Rate limiter storage | `memory://` instead of Redis |
| `SlowAPIMiddleware` | Removed (breaks asyncpg connection sharing) |

Use `AUTH_HEADERS` (a constant dict) for authenticated requests.

## Mocking Rules

- **Only mock the three external boundaries**: `app.state.carrier`, `app.state.engine`, Redis.
- **Never mock** internal repositories, services, or SQLAlchemy internals -- use the real DB.
- Use `AsyncMock` for async provider methods, `MagicMock` for sync.
- If you need to mock settings or httpx, use `patch()` context managers scoped to the test.

## Test File Conventions

- Inline helper factories per file (e.g., `_make_request()`, `_make_event()`). No shared utils module.
- `@pytest.mark.parametrize` for variant coverage.
- One test file per module under test, named `test_<module>.py`.

## Running Tests

| Command | Scope |
| --- | --- |
| `pytest` | Unit + integration (E2E excluded by default via `pytest.ini --ignore`) |
| `pytest tests/unit/` | Unit only |
| `pytest tests/integration/` | Contract fuzzing + multi-step flows |
| `pytest tests/e2e/` | Playwright (requires frontend on `:5173`) |

## E2E (Playwright)

E2E tests require both the backend and `npm run dev` on `:5173`.
The `browser_context_args` fixture in `tests/e2e/conftest.py` sets `base_url`, `reduced_motion`, and viewport.

## Contract Testing (Schemathesis)

`tests/integration/test_contract.py` auto-generates inputs from the OpenAPI schema using Schemathesis + Hypothesis (20 examples per endpoint). Fails on undocumented 5xx or schema mismatches.

## Load Testing (Locust)

`tests/load/locustfile.py` -- separate tool, not part of the pytest run.
