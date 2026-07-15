---
name: fix-scheduled
disable-model-invocation: true
description: 'Drives failing scheduled workflow runs (Nightly, Weekly Hardening) back to green: reproduces each failing job locally, delegates to the fix-* skills, and lands the fix on master through a gated PR.'
---

# Skill: Fix Scheduled Runs

Repair failing **scheduled** CI — the [Nightly](../../../.github/workflows/nightly.yml) and
[Weekly Hardening](../../../.github/workflows/weekly.yml) workflows. Unlike a PR, a scheduled
run has no branch to push to: it runs on `master`. So this skill **reproduces each failing job
locally** (the fast loop — no CI round-trip per iteration), delegates the actual repair to the
existing `fix-*` skills, and lands the fix on `master` **through a new branch + gated PR** —
never a direct push to `master`.

> **Depends on:** the `gh` CLI (authenticated), the local Docker stack (to reproduce backend
> failures and let the fixers verify), and the local lint/test toolchain. Landing a fix opens a
> PR and, once the PR Gate is green, **merges it** — outward-facing and irreversible. Running
> `/fix-scheduled` is the authorization; there is no per-merge prompt (same contract as
> [`/fix-prs`](../fix-prs/SKILL.md)).

This skill is a **dispatcher**, like `/fix-prs`. It never re-implements test/e2e/lint fixing —
that lives in `/fix-tests`, `/fix-e2e`, `/fix-lint`, `/fix-docker`. Its own value-add is:
find the failed scheduled run, map each failing job to the right local reproduction + fixer, and
manage the branch → push → PR → gate → merge lifecycle safely.

## Argument

- `/fix-scheduled nightly` — act on the latest failed **Nightly** run only.
- `/fix-scheduled weekly` — act on the latest failed **Weekly Hardening** run only.
- `/fix-scheduled` (no arg) — check **both**; act on whichever has a failing latest run.

## Step 0 — Preflight (before touching any branch)

1. **Working-tree safety (mandatory).** Run `git status --porcelain`. Step 5 creates a branch and
   commits, so a dirty tree must first be preserved as a **real commit** — never stashed-and-hoped,
   never committed to `master`. **Offer it and wait for an explicit yes** (no git writes without
   approval; see the `feedback-no-git-ops-without-asking` memory), then:
   - **On a feature branch:** commit the changes to it, and offer to `git push`.
   - **On `master`:** create a new branch first (e.g. `wip/<short-desc>`), commit there, offer to push.

   If the user declines, **stop and report** rather than proceeding over a dirty tree. Record the
   branch that now holds their work so Step 7 returns them to it.
2. **Offline / degraded path.** If `gh` is unavailable or unauthenticated (any `gh` call errors) but
   a canonical failure artifact already exists locally (`logs/test-failures.log`,
   `logs/e2e-failures.log`), skip the run-discovery/PR machinery entirely and just fix the current
   checkout: jump to Step 4 and delegate to the matching fixer for whatever artifact is populated.
   This is the path exercised headless.
3. **Docker check.** Reproduction and fixer verification need the stack. If it's down, you can still
   triage and read logs, but say so — the fixers will apply edits and defer verification.
4. **Find the failed run(s).** For each targeted workflow:
   `gh run list --workflow="<Nightly|Weekly Hardening>" --status=failure -L 1 --json databaseId,headSha,url,createdAt`.
   Nothing failing → report green and stop. Then list the failing **jobs** with
   `gh run view <run-id> --json jobs --jq '.jobs[] | select(.conclusion=="failure") | .name'`.

## Step 1 — Read known-fixes (first action, in parallel)

Read `.claude/skills/fix-scheduled/known-fixes.md` before triaging. For any failing job whose
signature matches a known-fix row, apply that documented action immediately (bump **Hits**, set
**Last used** to today). This short-circuit is mandatory — several scheduled-failure classes
(mutation-score reds, missing-artifact summary failures, Playwright browser installs, migration
drift) are fully determined and need no investigation.

## Step 2 — Triage each failing job: map job → reproduction + fixer

Map each failing job name from Step 0.4. **Do not read the raw CI job log** — it buries the real
error under ~1000 lines of container-boot noise (see `.claude/rules/tooling.md`). The job name plus
a local reproduction is enough; download an uploaded artifact (`gh run download <run-id> -n <name>`)
only to learn *which* tests failed (the junit XML) when the job name alone is ambiguous.

| Failing job (workflow) | Reproduce locally (produces the fixer's artifact) | Fixer |
|---|---|---|
| Full backend suite (nightly) | `python scripts/run-tests.py` | `/fix-tests` |
| Migration round-trip + drift detection (weekly) | `python scripts/run-tests.py` — slow tests run under the default `-m "not paid"` | `/fix-tests` |
| Resilience and chaos (weekly) | `python scripts/run-tests.py` | `/fix-tests` |
| Full frontend suite (nightly) | `python scripts/run-tests.py --target frontend-tests` | `/fix-tests` |
| Cross-browser E2E (nightly) | `python scripts/run-e2e.py --cross-browser` | `/fix-e2e` |
| Mutation testing report (weekly) | — **do not reproduce or "fix"** (see Hard Rule 2) | — report only |
| Weekly reliability summary (weekly) | — **not a test failure** (see Hard Rule 3) | — fix workflow YAML or report |

If a job maps to a fixer but its local reproduction **passes** (the failure doesn't reproduce), it
is a CI-only flake or an environment failure — **do not blind-fix**. Report it with the evidence and
offer the quarantine option (`tests/quarantine/`, which the weekly summary already counts); never
silently skip or xfail (see the `feedback-never-skip-never-cosmetic` memory).

## Step 3 — Reproduce locally on a fresh branch

The fix must land on `master` through a PR, so create the fix branch **before** reproducing (the
tree is clean per Step 0):

```
git checkout master && git pull && git checkout -b fix/<nightly|weekly>-<YYYY-MM-DD>
```

**Then** run the mapped check script(s). They write the canonical `logs/*.log` artifacts in the exact
format the fixers consume — this is why local beats parsing CI: one command regenerates a clean,
filtered log and the fixer reruns only affected tests to verify, all without a push.

## Step 4 — Fix (delegate)

Invoke the mapped fixers via the Skill tool, source-editing fixers before lint (a test fix can
introduce a lint violation): `/fix-tests` → `/fix-e2e` → then `/fix-lint`. Each reads its log,
applies the smallest fix, reruns only the specific failures, and stamps its log. Collect each
outcome; a fixer stopping to ask the user hands control back here — record it and continue.

## Step 5 — Commit + push + open PR

Commit the fixers' edits to the fix branch with a message describing what was fixed (end with the
`Co-Authored-By` trailer per the harness git rules), `git push -u origin HEAD`, then open a PR into
`master`:

```
gh pr create --base master --title "fix(ci): repair <nightly|weekly> — <short>" \
  --body "Fixes the <run URL> failure. <what failed → what was fixed>."
```

Nothing to commit → the run failed for a reason local reproduction didn't surface (CI-only flake, or
a mutation/summary non-failure). Report that per Step 7 rather than pushing an empty change.

## Step 6 — Wait for the PR Gate, then merge

Opening the PR triggers the [PR Gate](../../../.github/workflows/pr-gate.yml) — the same gate that
guards every merge to `master`. Poll for completion with **one line of git/gh** per cycle
(`gh pr checks <N>`) — never re-fetch the full PR object or job logs each cycle. When the gate is
green, **merge**: `gh pr merge <N> --merge`. If it goes red, return to Step 2 for the newly failing
job (max 2 push→gate rounds — a third means report the holdout, don't spin CI). If you'd rather hand
the merge lifecycle off, `/fix-prs <N>` owns exactly this loop — suggest it (it can't be Skill-invoked
from here; it's user-triggered).

## Step 7 — Restore + report

Return to the branch that held the user's work (the feature/`wip` branch from Step 0 if one was
committed, else the recorded original). Then report per workflow: which job failed, what was fixed,
whether the fix PR merged, and — for anything left open (flake, mutation/summary non-failure,
holdout) — the evidence and a recommendation.

## Log quality gate (both directions — mandatory)

Never fix *from* a bad artifact. When the fixer's log is unusable, the fix belongs in the **producing
script** (`scripts/run-tests.py` / `scripts/run-e2e.py`, named on the artifact's `# source:` header,
or the shared `scripts/diagnostics.py` filter), not in application code:

- **Missing detail** — a failure has no self-locating `file:line`, its traceback was stripped, or a
  summary names a failure with no matching block. Editing source would be a blind guess.
- **Drowning in noise** — real failures buried under passing results, expected warnings, or framework
  chatter. The signal is unfindable.

In either case, widen the capture / tighten the filter in the producing script, update that script's
test in the **same** change (`scripts/hooks/tests/`), tell the user to regenerate the artifact, and
stop. Don't waste cycles on a suboptimal log.

## Hard Rules

1. **Never push to `master`; never clobber uncommitted work.** Every fix lands via a new
   `fix/<nightly|weekly>-<date>` branch and a gated PR (Step 3, Step 5). A dirty tree becomes a real
   commit on a feature branch first, only after the user says yes; otherwise the run stops (Step 0).
2. **A red Mutation job is not a bug.** `run-mutation.py` and the weekly `mutation` job are
   `continue-on-error` and always exit 0 — surviving mutants are **informational** until the score
   target is met. Never open a PR to "fix" it; report the score and stop. (See `.claude/rules/`
   and the job's `continue-on-error: true`.)
3. **A Weekly reliability summary failure is plumbing, not a test.** That job downloads artifacts and
   comments on a pinned issue (`if: always()`); it fails when an upstream job was skipped (missing
   artifact) or the issue/token setup is off. Fix the **upstream job** (Step 2) or the workflow YAML —
   never run a code fixer against it.
4. **Reproduce before fixing.** Never edit source off a raw CI job log — regenerate the clean artifact
   locally (Step 3) and let the fixer work from it. If it can't reproduce (flake / env), report it and
   offer quarantine; don't guess-fix and don't silently skip.
5. **Don't loop CI.** Verify locally, push once, poll the gate cheaply. Max 2 push→gate rounds per PR
   before reporting a holdout.
6. **Dispatch, don't re-implement.** All fixing is delegated to the `fix-*` skills. This skill only
   finds the run, reproduces, and manages the PR lifecycle.
