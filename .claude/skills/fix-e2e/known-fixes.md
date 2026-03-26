# Known E2E Fixes

Quick-lookup table for recurring E2E failures. When a test fails with an error
matching a pattern below, apply the documented fix directly instead of reasoning
from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-e2e skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| `Access-Control-Allow-Origin` / `CORS policy` | CORS middleware uses wildcard `*` but frontend sends credentials (`include`) | Set `allow_origins` to the explicit frontend origin (e.g., `http://localhost:5173`) instead of `*`, or set `allow_credentials=True` with an explicit origin list in `app/main.py` | 2 | 2026-03-25 | 2026-03-25 |
| `assert 500 == 200` on `/health` | Vite proxy target unreachable inside Docker (`127.0.0.1:8000` doesn't reach the `app` container) | Make the Vite proxy target configurable via `VITE_PROXY_TARGET` env var; set it to `http://app:8000` in docker-compose.yml | 2 | 2026-03-25 | 2026-03-25 |
| `status=502` / `Bad Gateway` | Vite proxy cannot reach the backend on port 8000 | Ensure backend is running; check `vite.config.ts` proxy target matches the backend port | 0 | — | 2026-03-25 |
| `net::ERR_CONNECTION_REFUSED` / `ECONNREFUSED` | Backend or frontend dev server not running | Not a code fix — tell the user to start both servers (`docker compose up` + `npm run dev`) | 0 | — | 2026-03-25 |
| `Timeout` / `waiting for selector` / `waiting for navigation` | Page element not rendered within the default timeout | Check that the frontend component renders the expected DOM; increase test timeout only as a last resort | 0 | — | 2026-03-25 |
| `rendered a blank page` / `len(body_text.strip()) > 0` | Route exists but the page component renders nothing visible | Ensure the page component returns visible content and the route is registered in `frontend/src/routes.ts` | 0 | — | 2026-03-25 |
| `Uncaught JS errors on load` / `pageerror` | Unhandled exception in frontend JavaScript during page load | Check the browser console error message, trace to the throwing component, and fix the runtime error | 0 | — | 2026-03-25 |
| `Console errors:` / `console.error` | `console.error` calls during page load (e.g., failed fetch, React warnings) | Trace the logged error message to its source — usually a failed API call, missing env var, or React key warning | 0 | — | 2026-03-25 |
| `assert 401` / `assert 403` on E2E | Backend rejects the request due to missing or invalid auth | Check whether the E2E test needs auth headers, or whether the endpoint should be public (e.g., `/health`) | 0 | — | 2026-03-25 |
| `fixture 'page' not found` / `playwright` import error | Playwright not installed or `pytest-playwright` missing | Tell the user to run `pip install pytest-playwright && playwright install --with-deps chromium` | 0 | — | 2026-03-25 |
