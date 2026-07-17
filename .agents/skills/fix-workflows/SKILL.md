---
name: fix-workflows
disable-model-invocation: true
description: 'Drives the latest broken GitHub Actions workflows back to green: finds every workflow whose most recent completed run failed (skipping stale or already-fixed failures), reproduces each failing job locally, delegates to the fix-* skills, and lands the fix on master through a gated PR.'
---

# Skill: Fix Workflows

Repair failing **GitHub Actions workflows** — whichever ones are *currently* broken. A
workflow counts as broken only if its **latest completed run on `master` failed**; older
failures that a newer run already turned green are ignored. There is no PR branch to push
to for most of these runs, so this skill **reproduces each failing job locally** (the fast
loop — no CI round-trip per iteration), delegates the actual repair to the existing
`fix-*` skills, and lands the fix on `master` **through a new branch + gated PR** — never
a direct push to `master`.

> **Depends on:** the `gh` CLI (authenticated), the local Docker stack (to reproduce backend
> failures and let the fixers verify), and the local lint/test toolchain. Landing a fix opens a
> PR and, once the PR Gate is green, **merges it** — outward-facing and irreversible. Running
> `/fix-workflows` is the authorization; there is no per-merge prompt (same contract as
> [`/fix-prs`](../fix-prs/SKILL.md)).

This skill is a **dispatcher**, like `/fix-prs`. It never re-implements test/e2e/lint fixing —
that lives in `/fix-tests`, `/fix-e2e`, `/fix-lint`, `/fix-docker`. Its own value-add is:
find the workflows that are still red, filter out stale and already-fixed failures, map each
failing job to the right local reproduction + fixer, and manage the branch → push → PR →
gate → merge lifecycle safely.

## Argument

- `/fix-workflows <name>` — act on that workflow only (e.g. `nightly`, `weekly`,
  `sandbox-tests`; matched case-insensitively against the workflow name or file name).
- `/fix-workflows` (no arg) — scan **all** workflows; act on every one whose latest
  completed run failed.

## Scope: which runs this skill owns

| Run | Owner |
|---|---|
| Latest completed run of a workflow on `master` (schedule, `workflow_dispatch`, or push) failed | **This skill** |
| PR Gate / Dependabot workflow failing on a **PR branch** (`pull_request` / `workflow_run` events) | `/fix-prs` — that failure belongs to its PR; suggest it and skip the run here |
| A run on any other non-default branch | Skip and report — fix it from that branch's own PR |

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
4. **Find the broken workflows.** One recent-runs sweep is enough:

   ```
   gh run list -L 40 --json databaseId,workflowName,conclusion,status,event,headBranch,headSha,createdAt,url
   ```

   Group by `workflowName`, keeping only completed runs on `master` that are **not**
   `pull_request`/`workflow_run` events (those belong to `/fix-prs`, see Scope). Then apply the
   relevance filters:

   - **Already fixed:** the workflow's *latest* completed run succeeded → skip it, whatever failed
     before. Only a workflow whose latest completed run failed is a candidate.
   - **Stale:** the latest failure is **older than 14 days** and the workflow hasn't run since →
     don't blind-fix history. Report it and offer a single re-dispatch
     (`gh workflow run <file>` — dispatchable workflows only, and **never** Sandbox Tests, see
     Hard Rule 7) to learn whether it's still broken.
   - **Superseded:** `master` has moved past the failing run's `headSha`. Still a candidate — but
     the local reproduction in Step 3 is the arbiter: if it passes on current `master`, the failure
     is already fixed (or was a flake); report that and stop for this workflow.

   Nothing survives the filters → report all-green and stop. For each surviving run, list the
   failing **jobs**:
   `gh run view <run-id> --json jobs --jq '.jobs[] | select(.conclusion=="failure") | .name'`.

## Step 1 — Read known-fixes (first action, in parallel)

Read `.claude/skills/fix-workflows/known-fixes.md` before triaging. For any failing job whose
signature matches a known-fix row, apply that documented action immediately (bump **Hits**, set
**Last used** to today). This short-circuit is mandatory — several workflow-failure classes
(mutation-score reds, missing-artifact summary failures, Playwright browser installs, migration
drift, missing sandbox secrets) are fully determined and need no investigation.

## Step 2 — Triage each failing job: map job → reproduction + fixer

Map each failing job name from Step 0.4. **Do not read the raw CI job log** — it buries the real
error under ~1000 lines of container-boot noise (see `.claude/rules/tooling.md`). The job name plus
a local reproduction is enough; download an uploaded artifact (`gh run download <run-id> -n <name>`)
only to learn *which* tests failed (the junit XML) when the job name alone is ambiguous.

| Failing job (workflow) | Reproduce locally (produces the fixer's artifact) | Fixer |
|---|---|---|
| Full backend suite (Nightly) | `python scripts/run-tests.py` | `/fix-tests` |
| Full frontend suite (Nightly) | `python scripts/run-tests.py --target frontend-tests` | `/fix-tests` |
| Cross-browser E2E (Nightly) | `python scripts/run-e2e.py --cross-browser` | `/fix-e2e` |
| Migration round-trip + drift detection (Weekly) | `python scripts/run-tests.py` — slow tests run under the default `-m "not paid"` | `/fix-tests` |
| Resilience and chaos (Weekly) | `python scripts/run-tests.py` | `/fix-tests` |
| Mutation testing report (Weekly) | — **do not reproduce or "fix"** (see Hard Rule 2) | — report only |
| Weekly reliability summary (Weekly) | — **not a test failure** (see Hard Rule 3) | — fix workflow YAML or report |
| Lint + Test + Digest (On-Demand) | `python scripts/lint-all.py` and `python scripts/run-tests.py` | `/fix-lint`, `/fix-tests` |
| Backend / Lint / Frontend (PR Gate, **dispatch on `master`** only) | same as On-Demand | `/fix-lint`, `/fix-tests` |
| Lockfile environment markers (PR Gate) | recompile the lockfiles per the root `CLAUDE.md` Dependencies section — usually a Dependabot merge stripped the env markers (see the `dependabot-strips-lock-markers` memory) | — lockfile recompile, not a code fixer |
| Telnyx sandbox tier (Sandbox Tests) | **Preflight failure** → missing `sandbox`-environment secrets, an env fix not a code fix (see known-fixes). **Test failure** → needs live sandbox credentials locally (`TELNYX_SANDBOX=1 pytest -m sandbox`); without them, triage from the `sandbox-test-results` junit artifact and say verification is deferred | env fix / `/fix-tests` |

If a job maps to a fixer but its local reproduction **passes** (the failure doesn't reproduce), it
is already fixed on `master`, a CI-only flake, or an environment failure — **do not blind-fix**.
Report it with the evidence and offer the quarantine option (`tests/quarantine/`, which the weekly
summary already counts); never silently skip or xfail (see the `feedback-never-skip-never-cosmetic`
memory).

## Step 3 — Reproduce locally on a fresh branch

The fix must land on `master` through a PR, so create the fix branch **before** reproducing (the
tree is clean per Step 0):

```
git checkout master && git pull && git checkout -b fix/<workflow>-<YYYY-MM-DD>
```

**Then** run the mapped check script(s). They write the canonical `logs/*.log` artifacts in the exact
format the fixers consume — this is why local beats parsing CI: one command regenerates a clean,
filtered log and the fixer reruns only affected tests to verify, all without a push.

One branch and one PR can carry fixes for **several** broken workflows when their failures are
being fixed in the same pass — don't open a PR per workflow unless the fixes are unrelated enough
that one failing gate would block the others.

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
gh pr create --base master --title "fix(ci): repair <workflow(s)> — <short>" \
  --body "Fixes the <run URL(s)> failure. <what failed → what was fixed>."
```

Nothing to commit → the run failed for a reason local reproduction didn't surface (CI-only flake,
already fixed on `master`, or a mutation/summary non-failure). Report that per Step 7 rather than
pushing an empty change.

## Step 6 — Wait for the PR Gate, then merge

Opening the PR triggers the [PR Gate](../../../.github/workflows/pr-gate.yml) — the same gate that
guards every merge to `master`. Poll for completion with **one line of git/gh** per cycle
(`gh pr checks <N>`) — never re-fetch the full PR object or job logs each cycle. When the gate is
green, **merge**: `gh pr merge <N> --merge`. If it goes red, return to Step 2 for the newly failing
job (max 2 push→gate rounds — a third means report the holdout, don't spin CI). If you'd rather hand
the merge lifecycle off, `/fix-prs <N>` owns exactly this loop — suggest it (it can't be Skill-invoked
from here; it's user-triggered).

After the merge, confirm the workflow is actually green again:

- **Scheduled workflows** (Nightly, Weekly) verify on their next scheduled run — say so.
- **Dispatchable workflows** may be re-dispatched **once** (`gh workflow run <file>`) to confirm —
  except **Sandbox Tests**, which is never auto-dispatched (Hard Rule 7).

## Step 7 — Restore + report

Return to the branch that held the user's work (the feature/`wip` branch from Step 0 if one was
committed, else the recorded original). Then report per workflow: which job failed, what was fixed,
whether the fix PR merged, how green will be confirmed (next scheduled run / re-dispatch), and —
for anything left open (flake, stale run, mutation/summary non-failure, holdout) — the evidence and
a recommendation.

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
   `fix/<workflow>-<date>` branch and a gated PR (Step 3, Step 5). A dirty tree becomes a real
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
   locally (Step 3) and let the fixer work from it. If it can't reproduce (already fixed / flake /
   env), report it and offer quarantine; don't guess-fix and don't silently skip.
5. **Don't loop CI.** Verify locally, push once, poll the gate cheaply. Max 2 push→gate rounds per PR
   before reporting a holdout. At most one confirmation re-dispatch per workflow after a merge.
6. **Dispatch, don't re-implement.** All fixing is delegated to the `fix-*` skills. This skill only
   finds the broken workflows, reproduces, and manages the PR lifecycle.
7. **Never auto-dispatch Sandbox Tests.** It is the one workflow allowed to run a **paid tier**
   against live Telnyx sandbox credentials, deliberately dispatch-only (see the guard tests named in
   `sandbox-tests.yml`). Offer the `gh workflow run sandbox-tests.yml` command to the user instead —
   running it is their call.
8. **Runs on PR branches belong to `/fix-prs`.** Never fix a `pull_request`-event failure from here;
   suggest `/fix-prs` and move on (Scope table).
