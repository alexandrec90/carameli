import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { portFrom } from './vite.config.ts'

/**
 * The dev server's port is a correctness concern, not a preference.
 *
 * Several checkouts of this project run at once by design (`README.md`, Parallel
 * Worktrees). With `strictPort` absent, a second host-Vite silently slid to the next
 * free port and served *another checkout's build* to anyone who opened the
 * conventional one — a failure that costs an hour and leaves no trace, because the
 * page renders perfectly, it is just the wrong page. These assertions are the
 * regression test for that.
 */
const ROOT = dirname(fileURLToPath(import.meta.url))
const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')

describe('portFrom', () => {
  it('reads a port out of the environment', () => {
    expect(portFrom({ VITE_PORT: '5179' }, 'VITE_PORT', 5173)).toBe(5179)
    expect(portFrom({ VITE_PORT: ' 5179 ' }, 'VITE_PORT', 5173)).toBe(5179)
  })

  it('falls back when the key is absent or blank', () => {
    expect(portFrom({}, 'VITE_PORT', 5173)).toBe(5173)
    expect(portFrom({ VITE_PORT: '' }, 'VITE_PORT', 5173)).toBe(5173)
    expect(portFrom({ VITE_PORT: '   ' }, 'VITE_PORT', 5173)).toBe(5173)
  })

  it('falls back rather than throwing on anything unusable', () => {
    // A typo in a gitignored file should start the server, not break the build.
    for (const raw of ['banana', '-1', '0', '99999', '5173.5abc', 'NaN']) {
      expect(portFrom({ VITE_PORT: raw }, 'VITE_PORT', 5173)).toBe(5173)
    }
  })

  it('keeps the two servers on separate keys', () => {
    const env = { VITE_PORT: '5179', VITE_PREVIEW_PORT: '4179' }
    expect(portFrom(env, 'VITE_PORT', 5173)).toBe(5179)
    expect(portFrom(env, 'VITE_PREVIEW_PORT', 4173)).toBe(4179)
  })
})

describe('the dev server config', () => {
  it('refuses to slide onto another port', () => {
    // The one assertion that matters. If either of these ever reads `false`, or goes
    // missing again, a parallel checkout starts answering on a port nobody asked for.
    expect(config).not.toContain('strictPort: false')
    expect(config.match(/strictPort: true/g)).toHaveLength(2)
  })

  it('takes both ports from the environment, so a worktree can have its own', () => {
    expect(config).toContain("portFrom(env, 'VITE_PORT'")
    expect(config).toContain("portFrom(env, 'VITE_PREVIEW_PORT'")
  })

  it('adds the derived worktree offset to both bases', () => {
    // The half that makes a worktree work with NO `.env`, which is the only thing that
    // holds across all three ways one is cut here. Without the offset the fallbacks are
    // bare constants again and two checkouts both want 5173 — now a startup error
    // rather than a silent slide, but still two servers that cannot both run.
    expect(config).toContain('DEV_PORT + offset')
    expect(config).toContain('PREVIEW_PORT + offset')
  })

  it('derives the offset from the checkout, not from `frontend/`', () => {
    // This config sits one level under the worktree directory, so `rootDir` is the
    // leaf `frontend` and carries no worktree name at all. Passing it derived 0 for
    // every worktree and asked for 5173 again — the whole bug, wired up and silent,
    // and green under a unit test whose paths all ended at the worktree. Only a real
    // `npm run dev` showed it, so the call site gets its own assertion.
    expect(config).toContain('portOffset(repoRoot)')
    expect(config).not.toContain('portOffset(rootDir)')
    expect(config).toContain("const repoRoot = resolve(rootDir, '..')")
  })

  it('keeps the dev and preview pair on one offset', () => {
    // 4179 has to be the preview for 5179. Two independent derivations would drift the
    // moment either base or the span changed.
    expect(config.match(/\+ offset/g)).toHaveLength(2)
    expect(config.match(/const offset = /g)).toHaveLength(1)
  })

  it('keeps the dev base on the port the rest of the repo hardcodes', () => {
    // 5173 is not a preference here: `app/core/constants.py`'s DEFAULT_FRONTEND_ORIGIN,
    // `scripts/run-e2e.py`, `scripts/run-ci.py` and the compose port mapping all name
    // it. Moving the base moves them, and this is the cheapest place to notice.
    expect(config).toContain('const DEV_PORT = 5173')
    const constants = readFileSync(resolve(ROOT, '../app/core/constants.py'), 'utf8')
    expect(constants).toContain('http://localhost:5173')
  })

  it('documents the override where an agent in a worktree will look', () => {
    // `frontend/.env` is gitignored and there is no template for it, so this file is
    // the only committed place a session can learn that its port is derived at all —
    // which is the actual failure being fixed: not the collision, but the rounds spent
    // screenshotting the wrong server before noticing.
    const guide = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8')
    expect(guide).toContain('VITE_PORT')
    expect(guide).toContain('worktreePort.ts')
  })
})
