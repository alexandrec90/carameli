---
name: fix-prs
disable-model-invocation: true
description: 'Fixes failing open PRs by reproducing each gate failure locally, delegating to the fix-* skills, pushing, and auto-merging once the PR Gate is green.'
---

# Skill: Fix Pull Requests

Drive open PRs to green and merge them. For each target PR this skill **reproduces the
gate failure locally** (the fast loop — no CI round-trip per iteration), delegates the
actual repair to the existing `fix-*` skills, pushes the fix to the PR branch, waits for
the real PR Gate to confirm, then auto-merges.

> **Depends on:** the `gh` CLI (authenticated), the local Docker stack (to reproduce
> backend failures and let the fixers verify), and the local lint toolchain. Merging is
> **outward-facing and irreversible** — this skill auto-merges by design (see Hard Rules
> for the one carve-out). Running `/fix-prs` is the authorization; there is no per-merge
> prompt.

This skill is a **dispatcher**. It never re-implements test/lint/e2e fixing — that lives in
`/fix-tests`, `/fix-lint`, `/fix-e2e`, `/fix-docker`. Its own value-add is: pick the PRs,
map each failing gate job to the right local reproduction + fixer, and manage the
push→gate→merge lifecycle safely.

## Argument

- `/fix-prs <N>` — act on PR `#N` only.
- `/fix-prs` (no arg) — act on **every open PR** (`gh pr list --state open`), one at a time.

## Step 0 — Preflight (do this before touching any branch)

1. **Working-tree safety (mandatory).** Run `git status --porcelain`. `gh pr checkout` (Step 3)
   switches branches and would clobber uncommitted work, so a dirty tree must first be
   preserved as a **real commit** — never stashed-and-hoped, never committed to `master`.
   **Offer it and wait for an explicit yes** (no git writes without approval), then:
   - **On a feature branch:** commit the changes to it, and offer to `git push`.
   - **On `master`:** create a new branch first (e.g. `wip/<short-desc>`), commit the changes
     there, and offer to push — never commit to `master`.

   If the user declines, **stop and report** rather than proceeding over a dirty tree. Record the
   branch that now holds their work (`git rev-parse --abbrev-ref HEAD` after committing) so Step 7
   returns them to it.
2. **Offline / degraded path.** If `gh` is unavailable or unauthenticated (any `gh` call
   errors), but a canonical failure artifact already exists locally (`logs/test-failures.log`,
   `logs/lint-errors.log`, `logs/e2e-failures.log`, `logs/docker/*.log`), skip the PR/merge
   machinery entirely and just fix the current checkout: jump to Step 4 and delegate to the
   matching fixer for whatever artifact is populated. This is the path exercised headless.
3. **Docker check.** Reproduction and fixer verification need the stack. If it's down, you can
   still triage and read logs, but say so — the fixers will apply edits and defer verification.
4. **Resolve targets.** One PR from the arg, or all open PRs. For each, get failing checks with
   `gh pr checks <N>` and metadata with
   `gh pr view <N> --json number,headRefName,author,labels,mergeable,mergeStateStatus`.
   **Skip** a PR that is already green (nothing to fix) or already labelled `automerge` and
   passing — the existing [dependabot-automerge](../../../.github/workflows/dependabot-automerge.yml)
   / [dependabot-lock-repair](../../../.github/workflows/dependabot-lock-repair.yml) workflows own those.

## Step 1 — Read known-fixes (first action, in parallel)

Read `.claude/skills/fix-prs/known-fixes.md` before triaging. For any failing check whose
signature matches a known-fix row, apply that documented action immediately (bump **Hits**,
set **Last used** to today). This short-circuit is mandatory — several PR-failure classes
(lockfile-marker strips, `needs-manual-merge` labels, stale-branch conflicts) are fully
determined and need no investigation.

## Step 2 — Triage each PR: map failing job → reproduction + fixer

Read the failing **PR Gate** job names and map them. **Do not read the raw CI job log** — it
buries the real error under ~1000 lines of container-boot noise (see `.claude/rules/tooling.md`).
Pull the filtered artifact **first** — before any local run — to learn the failure *class*
(`gh run download <run-id> -n lint-errors -D logs/` gives the canonical `logs/lint-errors.log`;
delete any stale `logs/<name>.log` beforehand — `gh run download` refuses to overwrite an
existing file), then reproduce locally to get the clean artifact the fixer consumes.

**Skip local reproduction for project-global checks.** Some check results don't depend on
the diff at all — pip-audit depends on the advisory DB and the installed environment, so a
local run can both miss what CI flagged and flag local-only venv drift CI never sees. For
those classes the CI artifact is authoritative: if it plus known-fixes fully determines the
fix (e.g. lockfile vuln → recompile), apply the fix directly and run the check locally only
*afterwards*, as verification.

| Failing PR Gate job | Reproduce locally (produces the artifact) | Fixer |
|---|---|---|
| Backend unit + integration | `python scripts/run-tests.py` — **but if the CI artifact (junit XML / filtered log) localizes the failure to one target, scope it** (`--target hook-tests`, etc.): a full local run can bury the gate's one failure under local-env noise the fixer will chase | `/fix-tests` |
| Frontend unit tests | `python scripts/run-tests.py --target frontend-tests` | `/fix-tests` |
| Lint | `python scripts/lint-all.py --paths $(git diff --name-only origin/master...HEAD)` — **never `--changed` here**: it scopes to the working-tree diff, which Step 0 guarantees is clean, so it lints 0 files and vacuously passes. `--changed` is only meaningful mid-fix, after a fixer has edited files. | `/fix-lint` |
| Lockfile environment markers | recompile locks (see known-fixes) | — (commit the recompiled locks) |
| E2E (nightly / on-demand, not the PR Gate) | `python scripts/run-e2e.py` | `/fix-e2e` |

## Step 3 — Reproduce locally

`gh pr checkout <N>` (safe — the tree is clean per Step 0), **then** run the mapped check
script(s) — unless Step 2 already fully determined the fix for a project-global check, in
which case apply it and verify after. The checkout is what makes this a reproduction: the scripts test whatever is on
disk, so without it they'd exercise `master`, not the PR. With the PR's branch checked out they
write the canonical `logs/*.log` artifacts in the exact format the fixers consume — this is why
local beats parsing CI: one command regenerates a clean, filtered log and the fixer reruns only
affected tests to verify, all without a push.

## Step 4 — Fix (delegate)

Invoke the mapped fixers via the Skill tool, source-editing fixers before lint (a test fix can
introduce a lint violation): `/fix-tests` → `/fix-e2e` → then `/fix-lint`. Each reads its log,
applies the smallest fix, reruns only the specific failures, and stamps its log. Collect each
outcome; a fixer stopping to ask the user hands control back here — record it and continue.

## Step 5 — Commit + push

Commit the fixers' edits to the PR branch with a message describing what was fixed (end with the
`Co-Authored-By` trailer per the harness git rules) and `git push`. Nothing to commit → the PR
failed for a reason local reproduction didn't surface (e.g. a CI-only flake); report that rather
than pushing an empty change.

## Step 6 — Wait for the gate, then merge

Push restarts the PR Gate. Poll for completion with **one line of git/gh** per cycle
(`gh pr checks <N>` or `git merge-base --is-ancestor <sha> origin/master`) — never re-fetch the
full PR object or job logs each cycle. When the gate is green, **auto-merge**:
`gh pr merge <N> --merge`. If it goes red again, return to Step 2 for that PR (max 2 push→gate
rounds — a third means report the holdout, don't spin CI).

## Step 7 — Restore + report

Return to the branch that holds the user's work — the feature/`wip` branch from Step 0 if one
was committed, else the recorded original branch (`git checkout <recorded-branch>`). Then report
per PR: what failed, what was fixed, whether it merged, and — for anything left open — the
evidence and a recommendation.

## Hard Rules

1. **Never clobber uncommitted work; never commit to `master`.** A dirty tree becomes a real
   commit on a feature branch first (its own new `wip/` branch if currently on `master`), only
   after the user says yes; otherwise the run stops (Step 0). Checking out a PR branch over the
   user's changes is never acceptable.
2. **Respect `needs-manual-merge`.** A PR carrying that label is a runtime-major bump the repo
   deliberately holds for human review (see `dependabot-automerge.yml`). Fix it to green if it's
   failing, but **do not merge it** — report it as ready for the user's review. This is the one
   carve-out to auto-merge.
3. **Don't fight the bots.** Skip PRs already `automerge`-labelled-and-passing or mid
   lock-repair; those workflows will merge them.
4. **Reproduce before fixing.** Never edit source off a raw CI job log — regenerate the clean
   artifact locally (Step 3) and let the fixer work from it. If reproduction can't surface the
   failure (CI-only), report it; don't guess-fix.
5. **Don't loop CI.** Verify locally, push once, poll the gate cheaply. Max 2 push→gate rounds
   per PR before reporting a holdout.
6. **Dispatch, don't re-implement.** All fixing is delegated to the `fix-*` skills. This skill
   only selects, reproduces, and manages the merge lifecycle.
