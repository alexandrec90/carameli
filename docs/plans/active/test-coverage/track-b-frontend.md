# Track B — Frontend Tests

Two sequential sessions. Session B1 adds Vitest unit/component tests; B2 expands Playwright to
a cross-browser matrix. Both are fully independent of the backend tracks.

---

## Codebase orientation

```text
frontend/
  src/
    api/client.ts          ← fetch wrapper + typed API surface
    hooks/
      useAuth.ts
      useDashboard.ts
      useExtensions.ts
      usePhoneLines.ts
    lib/logger.ts           ← batching logger that POSTs to /vg/1.0.0/frontend-logs
    skins/
      registry.ts           ← dynamic skin loader
      types.ts              ← SkinModule interface
      carameli/index.ts
      barebone/index.ts
      candy-shop/index.ts
      comic-book/index.ts
    tests/
      smoke.test.ts         ← currently just `expect(true).toBe(true)`
    routes.ts
    vite-env.d.ts
```

The existing test harness is Vitest. Run tests with:

```bash
cd frontend && npm test         # watch mode
cd frontend && npm run test:run # single run (CI mode)
```

There are no testing-library or jsdom dependencies yet — **add them** if needed.
Check `frontend/package.json` first; add to `devDependencies` only what is missing.

---

## Session B1 — Vitest unit tests

**Use the `make-frontend-tests` skill** as the primary implementation tool. After it runs,
verify the files it created match the spec below and fill any gaps manually.

Invoke: `/make-frontend-tests`

If the skill is unavailable or incomplete, implement the following files manually.

### Required test files

#### `frontend/src/tests/api/client.test.ts`

Mock `fetch` globally. Test the `api` object exported from `src/api/client.ts`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
}

describe('api.health', () => {
  it('returns status on 200', async () => { ... })
})

describe('api.customers.get', () => {
  it('resolves with customer on 200', async () => { ... })
  it('throws on 404', async () => { ... })
})

describe('api.phoneLines.add', () => {
  it('sends POST with correct body', async () => { ... })
  it('throws and logs on 502', async () => { ... })
})
```

Cover: all methods in `api` (health, customers.get/create/getPhoneLines, phoneLines.getCount/add/deactivate, extensions.getAvailable/add).
For error paths, assert that `fetch` was called and that the promise rejects.

#### `frontend/src/tests/lib/logger.test.ts`

The logger (`src/lib/logger.ts`) writes to `console.*` and batches entries for POST to the backend.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('logger', () => {
  it('writes info to console.log', () => { ... })
  it('writes error to console.error', () => { ... })
  it('flushes immediately on error level', () => { ... })
  it('batches non-error entries', () => { ... })
})
```

Mock `fetch` to capture POSTs to `/vg/1.0.0/frontend-logs`. Use `vi.useFakeTimers()` to
control the 2-second batch flush interval.

#### `frontend/src/tests/hooks/usePhoneLines.test.ts`

Use Vitest + a minimal React test setup. If `@testing-library/react` is not in `package.json`,
add it. Use `renderHook` from `@testing-library/react`.

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { usePhoneLines } from '../../hooks/usePhoneLines'

describe('usePhoneLines', () => {
  it('loading state is true on mount', () => { ... })
  it('populates lines on success', async () => { ... })
  it('sets error on fetch failure', async () => { ... })
})
```

Repeat the same pattern for `useExtensions`, `useDashboard`, and `useAuth`.
Each hook test covers: initial loading state, success transition, error state.

#### `frontend/src/tests/skins/registry.test.ts`

The skin registry (`src/skins/registry.ts`) exports a function that returns a `SkinModule`
given a skin name. Test:

```typescript
describe('skin registry', () => {
  it('loads carameli skin without throwing', async () => { ... })
  it('loads barebone skin without throwing', async () => { ... })
  it('falls back gracefully on unknown skin name', async () => { ... })
  it('returns an object matching the SkinModule interface', async () => { ... })
})
```

Mock dynamic `import()` via `vi.mock` to avoid loading Three.js in the test environment.

### `package.json` additions (if missing)

```json
"devDependencies": {
  "@testing-library/react": "^16",
  "@testing-library/jest-dom": "^6",
  "jsdom": "^25",
  "happy-dom": "^14"
}
```

Update `vite.config.ts` (or `vitest.config.ts`) to set `environment: 'happy-dom'` (lighter
than jsdom for hook tests).

### Verification (B1)

```bash
cd frontend && npm run test:run
```

All tests must pass. No `console.error` output in the test run (those indicate missing mocks).

---

## Session B2 — Cross-browser and mobile E2E matrix

**Prerequisite:** Both the backend (`localhost:8000`) and the frontend dev server
(`localhost:5173`) must be running. The existing E2E suite in `tests/e2e/` uses Playwright.

Read `tests/e2e/conftest.py` and `tests/e2e/test_smoke.py` before starting.

### Step 1 — Install Playwright browsers

```bash
playwright install chromium firefox webkit
```

If Playwright is already installed, run `playwright install --with-deps` to ensure all
browser binaries are present.

### Step 2 — Update `tests/e2e/conftest.py`

The existing conftest sets `base_url`, `reduced_motion`, and viewport for a single browser.
Extend it to parametrize across browsers and viewports.

Add a fixture:

```python
import pytest
from playwright.async_api import async_playwright

BROWSERS = ["chromium", "firefox", "webkit"]
VIEWPORTS = [
    {"width": 1280, "height": 800, "label": "desktop"},
    {"width": 375, "height": 812, "label": "mobile-portrait"},
    {"width": 812, "height": 375, "label": "mobile-landscape"},
]
```

Use `pytest.fixture(params=BROWSERS)` combined with a `browser_name` fixture to launch
the correct browser engine. See Playwright docs for `async_playwright().start()` + `browser_type`.

### Step 3 — New test file: `tests/e2e/test_cross_browser.py`

```python
"""Cross-browser smoke matrix.

Runs the same core user journeys on Chromium, Firefox, and WebKit.
Also validates mobile viewports for layout breakage.
"""

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Parameterize over browsers and viewports using the fixtures from conftest.py


async def test_home_page_loads(page, base_url):
    """Verify the app shell renders without JS errors on all browsers."""
    errors = []
    page.on("pageerror", lambda e: errors.append(e))
    await page.goto(base_url)
    await page.wait_for_load_state("networkidle")
    assert errors == [], f"JS errors on page load: {errors}"


async def test_health_endpoint_reachable(page, base_url):
    """Verify /health returns ok via the frontend proxy."""
    resp = await page.request.get(f"{base_url}/health")
    assert resp.ok
    data = await resp.json()
    assert data["status"] == "ok"


async def test_no_layout_overflow_on_mobile(page, base_url):
    """Verify no horizontal scrollbar on 375 px viewport."""
    await page.set_viewport_size({"width": 375, "height": 812})
    await page.goto(base_url)
    # Check document.documentElement.scrollWidth <= 375
    scroll_width = await page.evaluate("document.documentElement.scrollWidth")
    assert scroll_width <= 375, f"Horizontal overflow detected: scrollWidth={scroll_width}"
```

### Step 4 — Browser matrix (`tests/e2e/conftest.py`)

**Carameli's E2E tier is Python-side pytest-playwright, not the Node runner.** The tests
in `tests/e2e/` are `.py`, `scripts/run-e2e.py` drives them through pytest, and
`nightly.yml` installs browsers with the Python CLI (`playwright install --with-deps`).
Configure the browser matrix with `conftest.py` fixtures:

```python
@pytest.fixture(params=["chromium", "firefox", "webkit"])
def browser_name(request: pytest.FixtureRequest) -> str:
    return request.param
```

Do **not** add a root `playwright.config.ts`. One existed until 2026-08-07 and was
dead the whole time: it declared `testDir: './tests/e2e'`, a directory holding only
Python files, and nothing ever invoked `playwright test`. Its only effect was to pull
`@playwright/test` into a root `package.json` and a 1.6 GB root `node_modules/` that no
build, test, or CI job read. The config, the manifest, and the tree were removed
together — a Node runner config here is a recurrence, not a gap.

### Step 5 — `pytest.ini` / CI exclusion

E2E tests require a live frontend. Exclude them from the default `pytest` run:

```ini
# pytest.ini
addopts = --ignore=tests/e2e --ignore=tests/load
```

Run explicitly:

```bash
pytest tests/e2e/ --browser=chromium --browser=firefox --browser=webkit
```

### Verification (B2)

```bash
# Start both servers first
pytest tests/e2e/ -v
```

Expected: all browsers pass `test_home_page_loads` and `test_health_endpoint_reachable`.
Mobile overflow test may need CSS fixes — document any failures before marking complete.
