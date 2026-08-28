/**
 * The comic-book skin's stylesheets, read as source, for the tests that guard rules a
 * renderer cannot express — a border that must not be painted, a layer that must not
 * outrank another. jsdom applies no CSS, so reading the files is the only way those
 * invariants get checked at all.
 *
 * **Read from disk rather than through `import.meta.glob('…', { query: '?raw' })`**, which
 * is what this replaced. Vitest runs with `css: false` (the default), and that stubs every
 * `.css` import — the `?raw` query included — to the **empty string**. The glob still
 * returned one key per stylesheet, so the file list looked right and every rule-matching
 * assertion over it passed against no content: `comicBookImageBorders.test.tsx` had been
 * reporting a clean stylesheet since the day it was written. A guard that greens on an
 * empty input is worse than no guard, so nothing here goes through the bundler.
 *
 * The reference below is what pays for that: `tsconfig.json` sets no `types`, and TS does
 * not pick `@types/node` up on its own here, so `node:fs` and `process` are unresolved
 * names to `lint:types` without it. It is a per-file reference rather than a `types`
 * entry in the tsconfig deliberately — the app code under `src/` runs in a browser, and
 * a project-wide `["node"]` would let a stray `process.env` typecheck its way into a
 * bundle.
 */

/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Where `src/` lives, whichever directory vitest was started from. */
function frontendRoot(): string {
  const cwd = process.cwd()
  // `npm --prefix frontend run test:run` starts in frontend/; a run from the repo root
  // does not. Both are spellings CI and the desktop tasks use.
  for (const candidate of [cwd, join(cwd, 'frontend')]) {
    try {
      readdirSync(join(candidate, 'src', 'skins', 'comic-book'))
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`no src/skins/comic-book under ${cwd} or its frontend/`)
}

/** Every `.css` file under `dir`, recursively, as paths relative to `from`. */
function cssUnder(dir: string, from: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return cssUnder(full, from)
    return entry.name.endsWith('.css') ? [full.slice(from.length + 1).replace(/\\/g, '/')] : []
  })
}

/**
 * The skin's stylesheets by path (posix-style, relative to `frontend/`), so a failure
 * names the file an offending rule is in. Every `.css` under the skin is included: a rule
 * about a picture or a panel may be written in any of them, and a hand-written list is a
 * list somebody forgets to add the eleventh stylesheet to.
 */
export const SKIN_CSS: Record<string, string> = (() => {
  const root = frontendRoot()
  const dir = join(root, 'src', 'skins', 'comic-book')
  return Object.fromEntries(
    cssUnder(dir, root).map(rel => [rel, readFileSync(join(root, rel), 'utf8')]),
  )
})()

/** `selector { body }` pairs, comments stripped — a comment may say "border" freely. */
export function cssRules(css: string): { selector: string; body: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selector: m[1].trim(),
    body: m[2],
  }))
}
