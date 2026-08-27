import { describe, expect, it } from 'vitest'

import type { ExecResult, Run } from './shipLayout'
import {
  DEFAULT_SUMMARY,
  monthDayStamp,
  planShip,
  shipLayout,
  slugify,
} from './shipLayout'

/**
 * Pins the trade documented in shipLayout.ts: the Ship button has to work from a
 * detached preview copy, a box, and the static checkout, and a failure anywhere after
 * the push must still leave the branch on the remote rather than reporting nothing.
 */

const FILE = 'frontend/src/skins/comic-book/editor/layoutConfig.ts'
const NOW = () => new Date(2026, 7, 26)

/**
 * Records every argv and answers from a table keyed by `cmd args`. A plain key matches
 * by prefix, longest first; a key prefixed with `=` matches the whole command only —
 * needed because `refs/heads/agent/panels-0826` is a prefix of `…-0826-2`, and a
 * prefix rule alone would tell the branch-name search that every candidate is taken.
 */
function fakeRun(table: Record<string, Partial<ExecResult>>) {
  const calls: string[][] = []
  const run: Run = (cmd, args) => {
    const full = `${cmd} ${args.join(' ')}`
    calls.push([cmd, ...args])
    const key = Object.keys(table)
      .filter(k => !k.startsWith('=') && full.startsWith(k))
      .sort((a, b) => b.length - a.length)[0]
    const hit = table[`=${full}`] ?? (key ? table[key] : undefined)
    return Promise.resolve({ code: 0, stdout: '', stderr: '', ...hit })
  }
  return {
    run,
    calls,
    /** Matches on the subcommand, not on a substring: a PR body says "commits" too. */
    ranGit: (sub: string) => calls.some(c => c[0] === 'git' && c[1] === sub),
    ran: (needle: string) => calls.some(c => c.join(' ').startsWith(needle)),
  }
}

/** A tree that is dirty, has a remote default of master, and no PR yet. */
function baseTable(head: string): Record<string, Partial<ExecResult>> {
  return {
    'git rev-parse --abbrev-ref HEAD': { stdout: `${head}\n` },
    'git symbolic-ref': { stdout: 'origin/master\n' },
    'git status --porcelain': { stdout: ` M ${FILE}\n` },
    'git rev-parse --verify': { code: 1 },
    'gh pr view': { code: 1, stderr: 'no pull requests found\n' },
    'gh pr create': { stdout: 'https://github.com/o/r/pull/9\n' },
  }
}

describe('slugify', () => {
  it('reduces a typed summary to what a branch name may carry', () => {
    expect(slugify('Reframe panel 8 & the home grid!')).toBe('reframe-panel-8-the-home-grid')
  })

  it('falls back rather than producing an empty branch segment', () => {
    expect(slugify('!!! ???')).toBe('comic-book-layout')
  })

  it('caps the slug so the branch name stays readable', () => {
    expect(slugify('a'.repeat(80)).length).toBe(40)
  })
})

describe('monthDayStamp', () => {
  it('zero-pads to the MMDD worktree.py stamps its branches with', () => {
    expect(monthDayStamp(new Date(2026, 0, 5))).toBe('0105')
  })
})

describe('planShip', () => {
  it('cuts a task branch when HEAD is detached', () => {
    const plan = planShip({ branch: null, defaultBranch: 'master' }, 'new bubbles', '0826')
    expect(plan).toEqual({ branch: 'agent/new-bubbles-0826', cutBranch: true })
  })

  it('cuts a task branch on the protected default branch', () => {
    const plan = planShip({ branch: 'master', defaultBranch: 'master' }, 'new bubbles', '0826')
    expect(plan.cutBranch).toBe(true)
  })

  it('reuses a branch somebody already chose, so a second Ship updates one PR', () => {
    const plan = planShip(
      { branch: 'agent/made-manual-changes-0826', defaultBranch: 'master' },
      'new bubbles',
      '0826',
    )
    expect(plan).toEqual({ branch: 'agent/made-manual-changes-0826', cutBranch: false })
  })
})

describe('shipLayout', () => {
  it('branches, commits, pushes and opens a PR from a detached preview copy', async () => {
    const { run, calls, ran } = fakeRun(baseTable('HEAD'))

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'New bubbles on panel 11')

    expect(out.ok).toBe(true)
    expect(out.branch).toBe('agent/new-bubbles-on-panel-11-0826')
    expect(out.prUrl).toBe('https://github.com/o/r/pull/9')
    expect(ran('git switch -c agent/new-bubbles-on-panel-11-0826')).toBe(true)
    // The push precedes the PR call: a machine with no gh still ends up with the work
    // on the remote.
    const pushed = calls.findIndex(c => c[1] === 'push')
    const prCall = calls.findIndex(c => c[0] === 'gh')
    expect(pushed).toBeGreaterThan(-1)
    expect(pushed).toBeLessThan(prCall)
  })

  it('commits only the layout file, never the rest of a box working tree', async () => {
    const { run, calls } = fakeRun(baseTable('agent/box-0826'))

    await shipLayout({ run, file: FILE, now: NOW }, '')

    const add = calls.find(c => c[1] === 'add')
    expect(add).toEqual(['git', 'add', '--', FILE])
  })

  it('uses the default summary when the author types nothing', async () => {
    const { run, calls } = fakeRun(baseTable('agent/box-0826'))

    await shipLayout({ run, file: FILE, now: NOW }, '   ')

    const commit = calls.find(c => c[1] === 'commit')
    expect(commit?.[3]?.startsWith(DEFAULT_SUMMARY)).toBe(true)
  })

  it('reports an existing PR as updated instead of opening a second one', async () => {
    const { run, ran } = fakeRun({
      ...baseTable('agent/box-0826'),
      'gh pr view': { stdout: 'https://github.com/o/r/pull/232\n' },
    })

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'more panels')

    expect(out.prUrl).toBe('https://github.com/o/r/pull/232')
    expect(out.message).toContain('PR updated')
    expect(ran('gh pr create')).toBe(false)
  })

  it('does not cut a branch when a detached copy has nothing to commit', async () => {
    const { run, ranGit } = fakeRun({
      ...baseTable('HEAD'),
      'git status --porcelain': { stdout: '' },
    })

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'no-op')

    expect(out.ok).toBe(true)
    expect(out.message).toContain('Nothing to ship')
    expect(ranGit('switch')).toBe(false)
  })

  it('still pushes an already-committed branch that never got a PR', async () => {
    const { run, ran, ranGit } = fakeRun({
      ...baseTable('agent/box-0826'),
      'git status --porcelain': { stdout: '' },
    })

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'retry')

    expect(out.branch).toBe('agent/box-0826')
    expect(ranGit('commit')).toBe(false)
    expect(ran('git push --set-upstream origin agent/box-0826')).toBe(true)
  })

  it('sidesteps a branch name that is already taken', async () => {
    const { run, ran } = fakeRun({
      ...baseTable('HEAD'),
      '=git rev-parse --verify --quiet refs/heads/agent/panels-0826': { code: 0, stdout: 'abc\n' },
    })

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'panels')

    expect(out.branch).toBe('agent/panels-0826-2')
    expect(ran('git switch -c agent/panels-0826-2')).toBe(true)
  })

  it('keeps the pushed branch when gh cannot open the PR', async () => {
    const { run } = fakeRun({
      ...baseTable('HEAD'),
      'gh pr create': { code: 1, stderr: 'gh: command not found\n' },
    })

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'panels')

    expect(out.ok).toBe(true)
    expect(out.branch).toBe('agent/panels-0826')
    expect(out.prUrl).toBeUndefined()
    expect(out.message).toContain('gh: command not found')
  })

  it('surfaces a blocked commit verbatim and says the layout is still saved', async () => {
    const { run } = fakeRun({
      ...baseTable('agent/box-0826'),
      'git commit': {
        code: 1,
        stderr: '[devkit branch policy] commit blocked on protected branch\n',
      },
    })

    const out = await shipLayout({ run, file: FILE, now: NOW }, 'panels')

    expect(out.ok).toBe(false)
    expect(out.message).toContain('[devkit branch policy] commit blocked')
    expect(out.message).toContain('still saved')
  })

  it('treats a repo whose origin has no HEAD ref as defaulting to master', async () => {
    const { run, ran } = fakeRun({
      ...baseTable('master'),
      'git symbolic-ref': { code: 1, stderr: 'ref refs/remotes/origin/HEAD is not a ref\n' },
    })

    await shipLayout({ run, file: FILE, now: NOW }, 'panels')

    expect(ran('git switch -c agent/panels-0826')).toBe(true)
  })
})
