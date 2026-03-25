# Frontend Test Writing Conventions

## Contents

- [Test file location and naming](#test-file-location-and-naming)
- [Imports](#imports)
- [Hook tests](#hook-tests--use-renderhook--mocked-api-client)
- [API client tests](#api-client-tests--mock-global-fetch)
- [R3F component tests](#r3f-component-tests--mock-at-canvas-boundary)
- [Candy Shop view tests](#candy-shop-view-tests--standard-dom-rendering)
- [SkinProvider tests](#skinprovider-tests--mock-registry-loaders)
- [Logger tests](#logger-tests--mock-fetch--fake-timers)
- [Page tests](#page-tests--verify-wiring)
- [Naming conventions](#naming-conventions)
- [What NOT to do](#what-not-to-do)

---

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
