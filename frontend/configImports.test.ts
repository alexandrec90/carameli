import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every relative import reachable from a Vite config file must carry its file
 * extension.
 *
 * The config is the one part of this tree that is NOT resolved by the bundler.
 * Vite's `configLoader: 'native'` — already the opt-in and planned to become the
 * default — hands the file to Node, which strips the types and then resolves the
 * specifiers itself. Node does no extension guessing, so `./devWatchPolicy` is
 * unresolvable there; today Vite falls back to its bundled loader and prints a
 * deprecation warning per extensionless import on every `npm run dev`, and when
 * the default flips it becomes a hard startup failure.
 *
 * `src/` is deliberately not in scope: extensionless is correct everywhere the
 * bundler does the resolving, which is everywhere else.
 */

const ROOT = dirname(fileURLToPath(import.meta.url))

/** The files a config loader is handed directly. */
const CONFIG_ENTRIES = ['vite.config.ts', 'vitest.bundle.config.ts']

const RELATIVE_IMPORT = /from\s+'(\.[^']*)'/g

function relativeImports(source: string): string[] {
  return [...source.matchAll(RELATIVE_IMPORT)].map(match => match[1])
}

/**
 * Every file the config graph reaches, entries included. Node loads the whole
 * graph, so a bare specifier one hop in fails exactly as one in the entry does.
 */
function configGraph(): string[] {
  const seen: string[] = []
  const queue = [...CONFIG_ENTRIES]
  while (queue.length > 0) {
    const relPath = queue.shift() as string
    if (seen.includes(relPath)) continue
    seen.push(relPath)
    const source = readFileSync(resolve(ROOT, relPath), 'utf8')
    for (const specifier of relativeImports(source)) {
      if (!specifier.endsWith('.ts')) continue
      queue.push(join(dirname(relPath), specifier.slice(2)))
    }
  }
  return seen
}

describe('the Vite config graph', () => {
  it.each(configGraph())('imports with file extensions in %s', relPath => {
    const source = readFileSync(resolve(ROOT, relPath), 'utf8')
    for (const specifier of relativeImports(source)) {
      expect(specifier, `${relPath} imports '${specifier}'`).toMatch(/\.[a-z]+$/)
    }
  })

  it('reaches the policy modules, so the assertion above has something to check', () => {
    expect(configGraph()).toContain('devWatchPolicy.ts')
    expect(configGraph()).toContain('proxyErrorPolicy.ts')
  })
})
