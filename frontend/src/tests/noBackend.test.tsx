import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { ROUTES } from '../routes'
import type { SkinName } from '../skins/registry'
import { SkinProvider } from '../skins/context'

// The default build is a UI demo with nothing behind it, and that is a property of the
// whole tree rather than of any one hook: one forgotten call is a red console line on every
// load, for a service that is not there. So it is asserted twice — by reading the source,
// and by rendering every route with the network and the console watched.

const SRC_DIR = path.resolve(__dirname, '..')

/**
 * The files allowed a network call.
 *
 * The comic-book layout editor's Save and Ship post to middleware in the Vite dev server
 * (`vite.config.ts`, `apply: 'serve'`). It is an authoring tool behind `?edit=1` under
 * `import.meta.env.DEV`, talks to no service, and does not run in a build.
 *
 * The rest are the live side of `VITE_LIVE_BACKEND`. Each is reached only past a test of
 * the switch, so the render below would catch one that leaked, and `LIVE_ONLY_MARKERS` in
 * `bundlePolicy.ts` proves none of them ships in a demo build.
 */
const ALLOWED_FILES = new Set([
  'skins/comic-book/editor/useLayoutTransport.ts',
  'api/liveClient.ts',
  'hooks/useAuth.ts',
  'hooks/useLiveSoftphone.ts',
  'lib/logShipping.ts',
])

const NETWORK_CALLS = [
  /\bfetch\(/,
  /\bnew WebSocket\(/,
  /\bnew EventSource\(/,
  /\bnew XMLHttpRequest\(/,
  /\bsendBeacon\(/,
  /from 'sip\.js/,
  /import\('sip\.js/,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === 'tests' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

/** `file`, with its comments gone, so prose about a fetch does not read as one. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the source', () => {
  it('holds no network call', () => {
    const offenders = sourceFiles(SRC_DIR).flatMap(file => {
      const relative = path.relative(SRC_DIR, file).split(path.sep).join('/')
      if (ALLOWED_FILES.has(relative)) return []
      const text = code(file)
      return NETWORK_CALLS.filter(call => call.test(text)).map(c => `${relative}: ${c.source}`)
    })
    expect(offenders).toEqual([])
  })

  // The bundler folds this literal early enough to drop the live side, and folds a constant
  // imported from another module too late: tidying these into one `LIVE_BACKEND` compiles,
  // passes every other test here, and puts the live client back in the entry chunk.
  it('tests the backend switch only as the literal a build can fold', () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter(file => !file.endsWith('.d.ts'))
      .filter(file => {
        const rest = code(file).replace(/import\.meta\.env\.VITE_LIVE_BACKEND === 'true'/g, '')
        return /VITE_LIVE_BACKEND|\bLIVE_BACKEND\b/.test(rest)
      })
      .map(file => path.relative(SRC_DIR, file))
    expect(offenders).toEqual([])
  })

  it('reads no URL argument to choose its data source', () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter(file => /\.get\('(sim|smsSim|callSim)'\)/.test(code(file)))
      .map(file => path.relative(SRC_DIR, file))
    expect(offenders).toEqual([])
  })
})

describe('a loaded page', () => {
  const fetchSpy = vi.fn()
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy.mockClear()
    vi.stubGlobal('fetch', fetchSpy)
    consoleError = vi.spyOn(console, 'error')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  /**
   * Mount the app on `route` and wait for `ready`, all of it inside `act`: the skin and
   * the page are lazy, and React reports either landing outside `act` through
   * `console.error`, which is the channel under test.
   */
  async function load(skin: SkinName, route: string, ready: (root: HTMLElement) => boolean) {
    localStorage.setItem('skin', skin)
    const { container } = render(
      <MemoryRouter initialEntries={[route]}>
        <SkinProvider>
          <App />
        </SkinProvider>
      </MemoryRouter>,
    )
    const tick = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 25)))
    for (let waited = 0; waited < 400 && !ready(container); waited += 1) await tick()
    expect(ready(container)).toBe(true)
    // The page's hooks answer on a microtask, and an error would surface right after.
    await tick()
  }

  // The requests a route makes belong to its hook, which is the same on every skin, so
  // one skin walks them. It is `barebone` because it animates nothing: framer-motion's
  // cleanup rejects under happy-dom, on a promise nothing in the app is holding.
  it.each(ROUTES.map(route => route.path))(
    'renders %s with no request and no console error',
    async route => {
      await load('barebone', route, root => (root.querySelector('main')?.childElementCount ?? 0) > 0)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    },
    20_000,
  )

  // Comic-book mounts the phone, the SMS threads and the live tables in its Layout, which
  // the other skins do not, so it gets a load of its own.
  it('mounts the comic-book page with no request and no console error', async () => {
    await load('comic-book', '/', root => root.querySelector('.cb-root') !== null)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  }, 20_000)
})
