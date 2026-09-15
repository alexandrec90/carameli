import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Nothing the page draws may reach the dev-only editor engine through a static import.
 *
 * The same property `frontend/bundlePolicy.test.ts` asserts against the real `dist/`, one
 * layer earlier and for a different audience. That one is complete — it reads what was
 * actually built — but it needs a build, and it answers with a string it found rather than
 * with the import that put it there. This one needs no build, runs in `test:run`, and
 * names the edge. Keep both: the dist check is the one that cannot be fooled, this is the
 * one that tells you what you just did.
 *
 * The history is in `bundlePolicy.ts`. In short: `Layout.tsx` called `useEditorMode`
 * directly, a hook cannot be called conditionally, and so 31.2 KB of mutators sat in every
 * production visitor's download for five consecutive raises of the chunk ceiling, with the
 * `import.meta.env.DEV` gate on the overlay looking for all the world like it had covered
 * the case.
 *
 * **A `import type` edge is free and deliberately allowed.** Types erase; only values pull
 * a module into a chunk. That is the whole distinction this file is built on, and it is
 * why the walk below skips type-only imports rather than treating every mention as an edge.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SKIN = resolve(HERE, '../../skins/comic-book')

/** Where the drawn page starts. Everything reachable from here ships to every visitor. */
const PAGE_ENTRY = 'Layout.tsx'

/**
 * The engine: the hook that builds an editor, everything it composes, and the config
 * mutators underneath. Reaching any of these from the page is the regression.
 *
 * `layoutConfig.ts`, `types.ts`, `selection.ts` and `transforms.ts` are deliberately absent
 * — they are the authored design and the shapes it is written in, which the page has to
 * have. The line is between *what was authored* and *what can change it*.
 */
const ENGINE = [
  'editor/useEditorMode.ts',
  'editor/useWorkingCopy.ts',
  'editor/useContentEdits.ts',
  'editor/useCallEdits.ts',
  'editor/useGridEdits.ts',
  'editor/editorStorage.ts',
  'editor/configOps.ts',
  'editor/configSeed.ts',
  'editor/configHydrate.ts',
  'editor/configPanels.ts',
  'editor/configPages.ts',
  'editor/EditorProvider.tsx',
  'editor/EditorOverlay.tsx',
]

/**
 * Static value imports in `source`, as written.
 *
 * Type-only imports are dropped, and so is `import('...')` — which has no `from` and so
 * never matches. That is the point rather than an accident: a dynamic import is a chunk
 * boundary, and the two the skin has are exactly how the editor is allowed to be reached.
 */
export function valueImports(source: string): string[] {
  const withoutTypes = source.replace(/^(?:im|ex)port\s+type\s[^\n]*\n/gm, '')
  const from = [...withoutTypes.matchAll(/^(?:im|ex)port\s[^\n]*?from\s+'([^']+)'/gm)]
  const bare = [...withoutTypes.matchAll(/^import\s+'([^']+)'/gm)]
  return [...from, ...bare].map(match => match[1])
}

/** A relative specifier as a path under the skin, or null when it is not one we follow. */
function resolveInSkin(fromRel: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const abs = resolve(SKIN, dirname(fromRel), specifier)
  for (const candidate of [abs, `${abs}.ts`, `${abs}.tsx`, join(abs, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('.css')) {
      const rel = relative(SKIN, candidate).split('\\').join('/')
      return rel.startsWith('..') ? null : rel
    }
  }
  return null
}

/** Every module inside the skin reachable from `entry` by static value imports. */
export function valueGraphFrom(entry: string): string[] {
  const seen: string[] = []
  const queue = [entry]
  while (queue.length > 0) {
    const rel = queue.shift() as string
    if (seen.includes(rel)) continue
    seen.push(rel)
    for (const specifier of valueImports(readFileSync(join(SKIN, rel), 'utf8'))) {
      const next = resolveInSkin(rel, specifier)
      if (next) queue.push(next)
    }
  }
  return seen
}

describe('valueImports', () => {
  it('takes a plain import and a side-effect import', () => {
    expect(valueImports("import { a } from './a'\nimport './b.css'\n"))
      .toEqual(["./a", './b.css'])
  })

  it('drops a type-only import, which erases and costs nothing', () => {
    expect(valueImports("import type { A } from './a'\nimport { b } from './b'\n"))
      .toEqual(['./b'])
  })

  it('drops a dynamic import, which is a chunk boundary rather than an edge', () => {
    expect(valueImports("const X = lazy(() => import('./editor/EditorOverlay'))\n")).toEqual([])
  })

  it('takes a re-export, which pulls the module in exactly as an import does', () => {
    expect(valueImports("export { a } from './a'\nexport type { B } from './b'\n"))
      .toEqual(['./a'])
  })
})

describe('the comic-book page graph', () => {
  const graph = valueGraphFrom(PAGE_ENTRY)

  it('reaches the page it is supposed to reach', () => {
    // Guards the guard: a walk that silently resolved nothing would pass the test below
    // having checked one file, which is the shape of failure this repo keeps finding.
    expect(graph).toContain('ComicPanel.tsx')
    expect(graph).toContain('layoutSource.ts')
    expect(graph).toContain('editor/editorContext.ts')
    expect(graph.length).toBeGreaterThan(30)
  })

  it('reaches no part of the dev-only editor engine', () => {
    expect(
      graph.filter(module => ENGINE.includes(module)),
      'A module the page draws imports a *value* from the editor engine, so the engine ' +
        'is in every visitor\'s download again. Types are free — `import type` erases — ' +
        'but a value edge defeats the `import.meta.env.DEV` gate entirely, because a hook ' +
        'has to be called unconditionally. Read editor state from ' +
        '`editor/editorContext.ts`, whose default is inert, and leave ' +
        '`editor/EditorProvider.tsx` as the only way in.',
    ).toEqual([])
  })
})
