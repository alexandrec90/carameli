import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Run } from './shipLayout'
import { shipLayout } from './shipLayout'

/**
 * The half `shipLayout.test.ts` cannot reach: whether the argv this module builds are
 * argv **real git accepts**. A wrong flag is invisible to a fake runner and shows up
 * only when somebody presses Ship — which is the exact moment the work is meant to stop
 * being lost, so it is worth a real repository.
 *
 * Everything is local: a bare repo stands in for origin and no network is touched. `gh`
 * has nothing to say about a `file://` remote, so this also exercises the degradation
 * that matters most — a push that lands even though no PR could be opened.
 */

const FILE = 'frontend/src/skins/comic-book/editor/layoutConfig.ts'

let tmp: string
let work: string
let remote: string

/** Spawns with a fixed argv, exactly as vite.config.ts wires the real endpoint. */
function runIn(cwd: string): Run {
  return (cmd, args) => {
    // A file:// remote can never have a GitHub PR. Do not spawn the user's real gh:
    // when it is installed but unauthenticated it opens an interactive login prompt,
    // leaving this otherwise-local test hung until Vitest's timeout.
    if (cmd === 'gh') {
      return Promise.resolve({ code: 1, stdout: '', stderr: 'no forge for file remote' })
    }
    return new Promise(done => {
      execFile(
        cmd,
        [...args],
        { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err: ExecFileException | null, stdout: string, stderr: string) => {
          const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
          done({ code, stdout, stderr: stderr || (err ? err.message : '') })
        },
      )
    })
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await runIn(cwd)('git', args)
  if (res.code !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr || res.stdout}`)
  return res.stdout.trim()
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ship-layout-'))
  work = join(tmp, 'work')
  remote = join(tmp, 'remote.git')
  const hooks = join(tmp, 'no-hooks')
  mkdirSync(join(work, 'frontend/src/skins/comic-book/editor'), { recursive: true })
  mkdirSync(hooks)

  await git(tmp, 'init', '--bare', '--initial-branch=master', remote)
  await git(tmp, 'init', '--initial-branch=master', work)
  // This machine installs devkit's branch policy through a global core.hooksPath. A
  // throwaway repo is not what that policy is about, and letting it run here would make
  // the test depend on a PR lookup for a branch no forge has ever seen.
  await git(work, 'config', 'core.hooksPath', hooks)
  await git(work, 'config', 'user.email', 'test@example.invalid')
  await git(work, 'config', 'user.name', 'Ship Layout Test')
  await git(work, 'config', 'commit.gpgsign', 'false')
  await git(work, 'remote', 'add', 'origin', remote)

  writeFileSync(join(work, FILE), 'export const PANEL_IMG_TRANSFORMS = []\n')
  await git(work, 'add', '--', FILE)
  await git(work, 'commit', '-m', 'seed')
  await git(work, 'push', 'origin', 'master')
}, 60_000)

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('shipLayout against a real repository', () => {
  it('branches off a detached HEAD and lands the commit on the remote', async () => {
    await git(work, 'checkout', '--detach')
    writeFileSync(join(work, FILE), 'export const PANEL_IMG_TRANSFORMS = [1]\n')

    const out = await shipLayout(
      { run: runIn(work), file: FILE, now: () => new Date(2026, 7, 26) },
      'Panel 8 reframed',
    )

    expect(out.ok).toBe(true)
    expect(out.branch).toBe('agent/panel-8-reframed-0826')

    // The push is the assertion that matters: the layout now exists somewhere a
    // `git worktree remove --force` cannot reach.
    const onRemote = await git(remote, 'rev-parse', `refs/heads/${out.branch}`)
    expect(onRemote).toMatch(/^[0-9a-f]{40}$/)
    const shipped = await git(remote, 'show', `${out.branch}:${FILE}`)
    expect(shipped).toContain('[1]')

    // No PR is possible against a file:// remote, and that must not read as failure.
    expect(out.prUrl).toBeUndefined()
    expect(out.message).toContain('but no PR')
  }, 60_000)

  it('reuses the branch it just cut, so a second Ship does not fork a third', async () => {
    writeFileSync(join(work, FILE), 'export const PANEL_IMG_TRANSFORMS = [1, 2]\n')

    const out = await shipLayout(
      { run: runIn(work), file: FILE, now: () => new Date(2026, 7, 26) },
      'Panel 9 too',
    )

    expect(out.ok).toBe(true)
    expect(out.branch).toBe('agent/panel-8-reframed-0826')
    const shipped = await git(remote, 'show', `${out.branch}:${FILE}`)
    expect(shipped).toContain('[1, 2]')
  }, 60_000)

  it('leaves an unrelated dirty file out of the commit', async () => {
    const stray = join(work, 'frontend/stray.txt')
    writeFileSync(stray, 'not part of the layout\n')
    writeFileSync(join(work, FILE), 'export const PANEL_IMG_TRANSFORMS = [1, 2, 3]\n')

    const out = await shipLayout(
      { run: runIn(work), file: FILE, now: () => new Date(2026, 7, 26) },
      'Panel 10',
    )

    expect(out.ok).toBe(true)
    const tracked = await git(work, 'status', '--porcelain')
    expect(tracked).toContain('stray.txt')
    const listed = await git(remote, 'ls-tree', '-r', '--name-only', String(out.branch))
    expect(listed).not.toContain('stray.txt')
  }, 60_000)
})
