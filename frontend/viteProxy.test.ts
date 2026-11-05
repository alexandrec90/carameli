import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BACKEND_PROXY_PATTERN } from './vite.config.ts'

const here = dirname(fileURLToPath(import.meta.url))
const proxied = new RegExp(BACKEND_PROXY_PATTERN)

/** Read as text: `routes.ts` pulls in every page, which belongs to the other tsconfig. */
function routePaths(): string[] {
  const source = readFileSync(resolve(here, 'src/routes.ts'), 'utf8')
  return [...source.matchAll(/\{ path: '([^']+)'/g)].map(match => match[1])
}

describe('the backend proxy', () => {
  it('finds the route list it is checking', () => {
    expect(routePaths()).toContain('/api-tokens')
  })

  // A proxied route loads fine by clicking through and fails on a reload, because only a
  // full page load reaches the dev server: the page then belongs to a backend that is gone.
  it('takes no page of the app', () => {
    expect(routePaths().filter(path => proxied.test(path))).toEqual([])
  })

  it.each(['/api/v1/x', '/auth/session', '/vsapi/1.0.0/x', '/vg/1.0.0/x', '/health'])(
    'still forwards %s',
    path => {
      expect(proxied.test(path)).toBe(true)
    },
  )
})
