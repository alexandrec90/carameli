import { relative, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CONFIG_IN_FRONTEND, CONFIG_IN_REPO, editorConfigFile } from './editorConfigPath.ts'

/**
 * The regression these pin: the comic-book editor's Save endpoint used to resolve its
 * target against `<frontend>/..`, which is the repo root on a host checkout and `/` in
 * the container, where only `frontend/` is bind-mounted. Every Save from the
 * containerised dev server therefore wrote to `/frontend/src/…` and failed with
 * `ENOENT`, so the editor's changes never reached `layoutConfig.ts` and the app outside
 * edit mode kept rendering the old layout.
 */
describe('the editor config path', () => {
  it('resolves the write target inside the frontend directory it is given', () => {
    const dir = resolve(sep, 'app')
    const file = editorConfigFile(dir)

    expect(file.startsWith(dir + sep)).toBe(true)
    expect(relative(dir, file).split(sep)).toEqual([
      'src',
      'skins',
      'comic-book',
      'editor',
      'layoutConfig.ts',
    ])
  })

  it('never resolves through a `frontend/` segment, which a frontend-only mount lacks', () => {
    const file = editorConfigFile(resolve(sep, 'app'))

    expect(relative(resolve(sep, 'app'), file).split(sep)).not.toContain('frontend')
  })

  it('spells the same file repo-relative for git', () => {
    expect(CONFIG_IN_REPO).toBe('frontend/src/skins/comic-book/editor/layoutConfig.ts')
    expect(CONFIG_IN_REPO.endsWith(CONFIG_IN_FRONTEND)).toBe(true)
  })
})
