/**
 * The server half of the comic-book editor's **Ship** button: turn the layout the
 * editor just saved into a pushed branch and a pull request, from whatever tree the
 * dev server happens to be serving.
 *
 * Three trees run this editor and each of them starts somewhere different:
 *
 * - an **ephemeral box** (`.worktrees/<project>--<slug>`) is already on an `agent/…`
 *   branch, so shipping is a commit and a push;
 * - a **UI preview copy** (`.ui-previews/<project>/<ref>`) is on a *detached* HEAD, and
 *   devkit's branch policy refuses a commit there outright;
 * - the **static checkout** sits on the default branch, which the same policy protects.
 *
 * The middle case is why this exists. A layout saved into a preview copy is invisible to
 * git until somebody cuts a branch by hand, and `preview-ui-host.py --clean` removes
 * those copies with `git worktree remove --force` — so the file the editor writes lives
 * in exactly one place that routine cleanup deletes. `planShip` therefore cuts a task
 * branch whenever HEAD is somewhere a commit is not allowed, instead of asking whoever
 * is dragging panels around to know which of the three trees the browser is pointed at.
 *
 * Every process call is injected — there is no `node:child_process` import here — so the
 * decisions below are unit-testable and the spawning stays in `vite.config.ts`, which
 * registers the endpoint under `apply: 'serve'` and so never reaches a production build.
 */

/** What a spawned `git`/`gh` call reports back. */
export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs one executable with a fixed argv. No shell: nothing here is ever interpolated. */
export type Run = (cmd: string, args: readonly string[]) => Promise<ExecResult>

export interface GitFacts {
  /** The checked-out branch, or `null` when HEAD is detached. */
  branch: string | null
  /** The remote's default branch. A commit on it is what the branch policy blocks. */
  defaultBranch: string
}

export interface ShipPlan {
  /** The branch the commit lands on. */
  branch: string
  /** Whether that branch has to be cut from HEAD first. */
  cutBranch: boolean
}

export interface ShipDeps {
  run: Run
  /** Repo-relative path of the file the editor overwrites. */
  file: string
  /** Injected so the branch stamp is deterministic under test. */
  now: () => Date
}

export interface ShipOutcome {
  ok: boolean
  /** One line for the toolbar, phrased for whoever pressed the button. */
  message: string
  branch?: string
  prUrl?: string
}

/** Used for the commit subject and the branch slug when the author types nothing. */
export const DEFAULT_SUMMARY = 'Update the comic-book layout from the editor'

/** How many `-2`, `-3`… suffixes to try before giving up on a free branch name. */
const MAX_BRANCH_ATTEMPTS = 20

/**
 * `agent/` and nothing else: devkit's `worktree.py` records boxes under this prefix and
 * `reconcile` looks their PRs up by branch name, so a branch cut here has to land in the
 * same namespace to be reaped rather than stranded.
 */
const BRANCH_PREFIX = 'agent/'

/** Trims a typed summary down to the `[a-z0-9-]` a branch name may carry. */
export function slugify(summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug || 'comic-book-layout'
}

/** `MMDD`, matching the stamp `worktree.py` puts on the branches it cuts. */
export function monthDayStamp(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}${dd}`
}

/**
 * Decide where the commit goes. Detached HEAD and the default branch both need a fresh
 * task branch; anything else is already a branch somebody chose, so it is reused rather
 * than forked — pressing Ship twice from a box has to update that box's PR, not open a
 * second one beside it.
 */
export function planShip(facts: GitFacts, summary: string, stamp: string): ShipPlan {
  if (facts.branch === null || facts.branch === facts.defaultBranch) {
    return { branch: `${BRANCH_PREFIX}${slugify(summary)}-${stamp}`, cutBranch: true }
  }
  return { branch: facts.branch, cutBranch: false }
}

/** Reads a `git`/`gh` failure back as one line, preferring stderr and never empty. */
export function failureText(cmd: string, args: readonly string[], res: ExecResult): string {
  const detail = (res.stderr || res.stdout).trim().split('\n').slice(0, 3).join(' ')
  return `${cmd} ${args.join(' ')} failed (${res.code}): ${detail || 'no output'}`
}

class ShipError extends Error {}

async function must(run: Run, cmd: string, args: readonly string[]): Promise<string> {
  const res = await run(cmd, args)
  if (res.code !== 0) throw new ShipError(failureText(cmd, args, res))
  return res.stdout.trim()
}

/** The first of `base`, `base-2`, `base-3`… that no local branch already claims. */
async function freeBranch(run: Run, base: string): Promise<string> {
  for (let n = 1; n <= MAX_BRANCH_ATTEMPTS; n++) {
    const name = n === 1 ? base : `${base}-${n}`
    const res = await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
    if (res.code !== 0) return name
  }
  throw new ShipError(`no free branch name near ${base} after ${MAX_BRANCH_ATTEMPTS} tries`)
}

/** `origin/master` -> `master`; falls back to `master` when origin has no HEAD ref. */
async function defaultBranchOf(run: Run): Promise<string> {
  const res = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (res.code !== 0) return 'master'
  return res.stdout.trim().replace(/^origin\//, '') || 'master'
}

function commitBody(summary: string, file: string): string {
  return [
    summary,
    '',
    `Authored in the comic-book layout editor (\`?edit=1\`) and shipped from its Ship`,
    `button, which writes ${file} and commits it here.`,
  ].join('\n')
}

/**
 * Save-to-branch-to-PR in one press.
 *
 * Ordering is deliberate: the push happens before the PR call, so a machine with no
 * working `gh` still ends with the work on the remote and reports the branch. Losing a
 * PR link is an inconvenience; losing the layout is the failure this button exists to
 * prevent.
 */
export async function shipLayout(deps: ShipDeps, summary: string): Promise<ShipOutcome> {
  const { run, file } = deps
  const title = summary.trim() || DEFAULT_SUMMARY

  try {
    const head = await must(run, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = head === 'HEAD' ? null : head
    const defaultBranch = await defaultBranchOf(run)
    const status = await must(run, 'git', ['status', '--porcelain', '--', file])
    const dirty = status.length > 0

    const plan = planShip({ branch, defaultBranch }, title, monthDayStamp(deps.now()))

    if (!dirty && plan.cutBranch) {
      return {
        ok: true,
        message: `Nothing to ship — ${file} already matches ${branch ?? 'the parked commit'}.`,
      }
    }

    const target = plan.cutBranch ? await freeBranch(run, plan.branch) : plan.branch
    if (plan.cutBranch) await must(run, 'git', ['switch', '-c', target])

    if (dirty) {
      await must(run, 'git', ['add', '--', file])
      await must(run, 'git', ['commit', '-m', commitBody(title, file)])
    }

    await must(run, 'git', ['push', '--set-upstream', 'origin', target])

    const existing = await run('gh', ['pr', 'view', target, '--json', 'url', '--jq', '.url'])
    if (existing.code === 0 && existing.stdout.trim()) {
      const prUrl = existing.stdout.trim()
      return { ok: true, branch: target, prUrl, message: `Pushed ${target} — PR updated.` }
    }

    const created = await run('gh', [
      'pr', 'create',
      '--head', target,
      '--title', title,
      '--body', commitBody(title, file),
    ])
    if (created.code !== 0) {
      return {
        ok: true,
        branch: target,
        message: `Pushed ${target}, but no PR: ${failureText('gh', ['pr', 'create'], created)}`,
      }
    }
    const prUrl = created.stdout.trim().split('\n').filter(Boolean).pop()
    return { ok: true, branch: target, prUrl, message: `Pushed ${target} — PR opened.` }
  } catch (err) {
    const message = err instanceof ShipError ? err.message : String(err)
    return { ok: false, message: `${message}. The layout is still saved — use .ts to keep a copy.` }
  }
}
