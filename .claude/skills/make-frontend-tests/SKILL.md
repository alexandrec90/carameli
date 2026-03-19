---
name: make-frontend-tests
description: 'Generate missing Vitest tests for frontend hooks, API client, skin system, views, pages, and shared components.'
argument-hint: 'Optional: a file path to target (e.g., "frontend/src/hooks/useDashboard.ts"), or "review" to audit for gaps only'
---

# Skill: Make Frontend Tests

Write new Vitest tests or review existing tests and add what is missing.
Follows the skin architecture rules: hooks own data, views are pure props,
pages are thin orchestrators. Mocks R3F at the Canvas boundary for carameli
skin components — never tests WebGL rendering.

---

## Step 1 — Determine Mode

| Argument | Mode |
| --- | --- |
| No argument | **Full audit** — scan all frontend source files, identify gaps, generate tests |
| `review` | **Review only** — report gaps without writing files |
| A file path | **Targeted** — generate tests for that file only |

---

## Step 2 — Load State

Read `.claude/skills/make-frontend-tests/state.json`. It tracks which modules
have been covered and when. Each entry:

```json
{
  "module": "frontend/src/hooks/useDashboard.ts",
  "test_file": "frontend/src/tests/useDashboard.test.ts",
  "last_reviewed": "YYYY-MM-DD",
  "git_hash": "<sha of module at review time>",
  "gaps_found": 0
}
```

If the file does not exist, treat it as `{ "last_run": null, "modules": [] }`.

---

## Step 3 — Discover Source Modules

Find all first-party TypeScript source files (skip tests, node_modules, dist):

```bash
find frontend/src -name "*.ts" -o -name "*.tsx" \
  | grep -v node_modules \
  | grep -v dist \
  | grep -v ".test." \
  | grep -v "__tests__" \
  | sort
```

Classify each file into a layer:

| Layer | Path pattern | Test strategy |
| --- | --- | --- |
| **Hooks** | `frontend/src/hooks/*.ts` | `renderHook` + mocked API client |
| **API client** | `frontend/src/api/client.ts` | Mocked `fetch` |
| **Logger** | `frontend/src/lib/logger.ts` | Mocked `fetch` + fake timers |
| **Skin system** | `frontend/src/skins/context.tsx`, `registry.ts`, `types.ts` | Provider render + mocked loaders |
| **Pages** | `frontend/src/pages/*.tsx` | Render with mocked hook + mocked skin |
| **Carameli views** | `frontend/src/skins/carameli/views/*.tsx` | Render with R3F mocked at Canvas boundary |
| **Candy Shop views** | `frontend/src/skins/candy-shop/views/*.tsx` | Standard React Testing Library render |
| **Shared components** | `frontend/src/components/*.tsx` | Standard React Testing Library render |
| **App** | `frontend/src/App.tsx`, `main.tsx` | Router integration test |

For each module, get its current last-commit hash:

```bash
git log --format="%H" -1 -- <filepath>
```

Triage (same rules as make-tests):

| Status | Condition | Action |
| --- | --- | --- |
| **SKIP** | In state.json, hash matches, gaps_found = 0 | Skip |
| **SKIP** | No git commit yet and not explicitly targeted | Skip |
| **CHANGED** | In state.json but hash differs | Re-evaluate |
| **NEW** | Not in state.json and has at least one commit | Full pass |

In **targeted** mode, the session-skip rule is bypassed.

---

## Step 4 — Audit Each Module

For each module to process:

**4a. Read the source file.** Identify:

- Every exported function, hook, component, or type
- State transitions (useState, useEffect dependencies)
- API calls (fetch, client methods)
- Error handling paths (try/catch, error states)
- Conditional rendering branches

**4b. Read the existing test file** (if it exists). Map what is already covered.

**4c. Identify gaps.** A gap is any of:

**Hook gaps:**

- Untested initial state (loading, error, data all at default)
- Untested success path (API returns data, state updates)
- Untested error path (API throws, error state set)
- Untested user actions (add, delete, refresh triggers)
- Missing `act()` wrapper for state updates

**API client gaps:**

- Untested method (each exported function needs a success + error test)
- Missing test for non-200 response (should throw or return error)
- Missing test for network failure (fetch rejects)
- Untested request shape (correct URL, method, headers, body)

**Logger gaps:**

- Queue batching not tested (logs accumulate, flush after interval)
- Immediate flush on error-level log not tested
- Console output not tested
- Fetch failure in ship-to-backend not tested (should not throw)

**Skin system gaps:**

- `SkinProvider` initial load (shows fallback, then resolves skin)
- `useSkin()` outside provider (should throw or return null)
- `useSkinSwitcher()` persists to localStorage
- `resolveSkinName()` with invalid name falls back to default
- Dynamic import failure (skin chunk fails to load)

**View gaps (carameli — R3F):**

- Component renders without throwing when R3F is mocked
- Correct props forwarded to child Three.js elements
- Conditional branches render correct elements

**View gaps (candy-shop — DOM):**

- Component renders with given props
- Conditional rendering (empty state, loading state, data state)
- User interaction (click handlers fire, input updates state)

**Page gaps:**

- Page calls the correct hook
- Page passes hook result to the correct skin view
- Page renders without throwing

**Component gaps:**

- Each variant renders (e.g. Button `primary` vs `ghost`)
- Disabled state prevents click handler
- Props forwarded correctly

Output a gap list before writing anything:

```text
Module: frontend/src/hooks/useDashboard.ts  →  frontend/src/tests/useDashboard.test.ts
  GAP: initial loading state not tested
  GAP: API error sets error state
  GAP: seedDemoCustomer triggers refetch
```

In **review** mode, stop here and print the full gap report. Do not write files.

---

## Step 5 — Write Tests

For each gap identified, append or create tests following these conventions:

### Test file location and naming

```text
frontend/src/tests/<module-name>.test.ts   — for non-JSX (hooks, API, logger)
frontend/src/tests/<module-name>.test.tsx  — for JSX (components, views, pages)
```

### Imports

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook, act } from '@testing-library/react'
```

### Hook tests — use renderHook + mocked API client

```typescript
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../api/client', () => ({
  api: {
    customers: {
      get: vi.fn().mockResolvedValue([]),
    },
  },
}))

import { api } from '../api/client'

describe('useDashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  test('initial state is loading', () => {
    const { result } = renderHook(() => useDashboard())
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
  })

  test('sets data after successful fetch', async () => {
    vi.mocked(api.customers.get).mockResolvedValue([{ id: '1', vs_customer_id: 100 }])
    const { result } = renderHook(() => useDashboard())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.customers).toHaveLength(1)
  })

  test('sets error on API failure', async () => {
    vi.mocked(api.customers.get).mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useDashboard())
    await waitFor(() => expect(result.current.error).toBeTruthy())
  })
})
```

### API client tests — mock global fetch

```typescript
describe('api.customers.get', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.restoreAllMocks())

  test('calls correct URL and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: '1' }]), { status: 200 })
    )
    const result = await api.customers.get()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/VsCustomer/'),
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual([{ id: '1' }])
  })

  test('throws on non-200 response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }))
    await expect(api.customers.get()).rejects.toThrow()
  })
})
```

### R3F component tests — mock at Canvas boundary

For carameli skin views, mock React Three Fiber and drei at the module level.
Never attempt to render actual WebGL content.

```typescript
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: () => ({ clock: { getElapsedTime: () => 0 }, size: { width: 800, height: 600 } }),
}))

vi.mock('@react-three/drei', () => ({
  Text3D: ({ children, ...props }: any) => <span data-testid="text3d" {...props}>{children}</span>,
  RoundedBox: ({ children, ...props }: any) => <div data-testid="rounded-box" {...props}>{children}</div>,
  Center: ({ children }: any) => <div>{children}</div>,
  Float: ({ children }: any) => <div>{children}</div>,
  OrbitControls: () => null,
  Environment: () => null,
}))

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: any) => <div>{children}</div>,
  Bloom: () => null,
  ChromaticAberration: () => null,
  Vignette: () => null,
}))

vi.mock('@react-spring/three', () => ({
  useSpring: () => ({ scale: 1, position: [0, 0, 0] }),
  animated: new Proxy({}, {
    get: (_target, prop) => (props: any) => <div data-testid={`animated-${String(prop)}`} {...props} />,
  }),
}))
```

Place R3F mocks in a shared setup file `frontend/src/tests/r3f-mocks.ts` so all
carameli view tests can import them. This is the one exception to the "no shared
fixtures unless 3+ files" rule — R3F mocking is verbose and identical across all
carameli view tests.

### Candy Shop view tests — standard DOM rendering

```typescript
import { render, screen } from '@testing-library/react'
import Dashboard from '../skins/candy-shop/views/Dashboard'

test('renders customer count', () => {
  render(<Dashboard customers={[{ id: '1', vs_customer_id: 100 }]} loading={false} error={null} />)
  expect(screen.getByText('1')).toBeInTheDocument()
})
```

### SkinProvider tests — mock registry loaders

```typescript
vi.mock('../skins/registry', () => ({
  skinLoaders: {
    carameli: vi.fn().mockResolvedValue({ default: mockSkin }),
  },
  SKIN_NAMES: ['carameli'],
  resolveSkinName: (name: string) => name === 'carameli' ? 'carameli' : 'carameli',
}))
```

### Logger tests — mock fetch + fake timers

```typescript
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('batches logs and flushes after interval', async () => {
  logger.info('msg1')
  logger.info('msg2')
  expect(fetch).not.toHaveBeenCalled()
  vi.advanceTimersByTime(2000)
  await vi.runAllTimersAsync()
  expect(fetch).toHaveBeenCalledOnce()
})
```

### Page tests — verify wiring

```typescript
vi.mock('../hooks/useDashboard', () => ({
  useDashboard: () => ({ loading: false, customers: [], error: null }),
}))
vi.mock('../skins/context', () => ({
  useSkin: () => ({
    Dashboard: (props: any) => <div data-testid="dashboard-view" />,
  }),
}))

test('Dashboard page renders skin view', () => {
  render(<DashboardPage />)
  expect(screen.getByTestId('dashboard-view')).toBeInTheDocument()
})
```

### Naming conventions

- File: `frontend/src/tests/<module>.test.ts` or `.test.tsx`
- Function: `test('<thing> <condition>')` — plain English, e.g. `test('sets error on API failure')`
- Describe blocks: `describe('<ModuleName>')` — match the export name

### What NOT to do

- Do not test WebGL rendering, material colors, lighting, or animation timing
- Do not import Three.js objects directly in tests — always mock at module boundary
- Do not add test utilities outside `frontend/src/tests/` (exception: `r3f-mocks.ts`)
- Do not test Vitest/React Testing Library behavior
- Do not mock internal hook state — mock the API client that feeds it
- Do not write tests for `types.ts` (type-only files have nothing to execute)

---

## Step 6 — Update State

After processing each module, update `.claude/skills/make-frontend-tests/state.json`:

- Set `last_reviewed` to today's date
- Set `git_hash` to the current hash of the source module
- Set `gaps_found` to the number of gaps discovered this run (0 if none)
- Set `last_run` on the root object to today's date

---

## Step 7 — Report

Print a summary table:

```text
## Frontend Test Coverage Pass — YYYY-MM-DD

| Module | Test File | Gaps Found | Tests Added |
|--------|-----------|-----------|-------------|
| hooks/useDashboard.ts | tests/useDashboard.test.ts | 3 | 3 |
| api/client.ts | tests/client.test.ts | 5 | 5 |
| skins/context.tsx | tests/context.test.tsx | 4 | 4 |
| skins/carameli/views/Dashboard.tsx | tests/carameli-dashboard.test.tsx | 2 | 2 |

Total: X gaps found, Y tests added.
```

### Gap category breakdown

```text
| Category | Gaps |
|----------|------|
| Hook (state/API) | N |
| API client | N |
| Logger | N |
| Skin system | N |
| Carameli views (R3F) | N |
| Candy Shop views (DOM) | N |
| Pages | N |
| Components | N |
```

List any modules skipped (unchanged since last pass).
Note any test failures that were not resolved.

---

## Hard Rules

1. Mock R3F at the `Canvas` / drei boundary — never render actual WebGL.
2. Mock the API client at module level for hook tests — never mock internal hook state.
3. One module at a time — complete audit, then write, before moving on.
4. Never modify source files. If a gap requires a source change, report it instead.
5. In **review** mode, never write or modify any file.
6. Do not test type-only files (`types.ts`, type re-exports).
7. Shared R3F mock file (`r3f-mocks.ts`) is the only allowed cross-test utility — all other fixtures stay in the test file.
8. Views must be tested with prop injection only — never call hooks inside view tests.
