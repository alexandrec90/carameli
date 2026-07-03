---
name: fix-all
disable-model-invocation: true
description: 'Fixes tests, E2E, then lint: runs /fix-tests, /fix-e2e, lints the working-tree diff, then runs /fix-lint.'
---

# Skill: Fix All

> Delegates to `/fix-tests`, `/fix-e2e`, and `/fix-lint`, which need the local stack /
> toolchain (and, for E2E, a running frontend + browser runner) to verify their fixes,
> and runs the lint suite over the diff itself.

A thin dispatcher. The fixing work — reading logs, fixing, rerunning to verify, the
`/fix-docker` handoff — lives in the sub-skills. Run these with the Skill tool **in this order**
(source-editing fixers run first because changing source changes what lint flags, so lint must
come last):

**Run every step, independently.** A sub-skill returning — whether it fixed everything, found a
green/empty log, hit a stale `--- ADDRESSED` or missing log, or stopped early to ask the user —
hands control straight back to this dispatcher. It does **not** abort the run: always continue to
the next step. Collect each sub-skill's outcome and report them together at the end.

1. **`/fix-tests`** — fixes `logs/test-failures.log` (produced up front by the check task,
   `scripts/run-tests.py`).
2. **`/fix-e2e`** — fixes `logs/e2e-failures.log` (produced up front by the check task's E2E leg,
   `scripts/run-e2e.py`). Runs after `/fix-tests` because E2E fixes are usually app-code changes,
   which must land before the lint step. Like `/fix-tests` it may edit `app/` and trigger a
   `/fix-docker` handoff if a restart breaks the stack. If the E2E log is missing (the check task
   didn't run the E2E leg, or the stack/frontend was down), `/fix-e2e` reports that and moves on —
   skip to the lint step.
3. **Lint the working-tree diff** — `python scripts/lint-all.py --changed`. The check task runs
   **tests only**, so this step is what produces `logs/lint-errors.log` for `/fix-lint`. Run it
   **unconditionally** — it must lint the user's pre-existing changes whether or not `/fix-tests`
   edited anything. `--changed` lints the whole working-tree diff (every changed file, not just
   what `/fix-tests` touched) and skips every tool with no relevant change, so it's cheap; it
   writes the same `logs/lint-errors.log` a full run would. Linting *after* `/fix-tests` is the
   point: a lint violation a test fix introduced would otherwise be invisible until CI. If the
   local lint toolchain isn't available, skip this and let `/fix-lint` run against whatever log
   already exists.
4. **`/fix-lint`** — fixes `logs/lint-errors.log`.

Each sub-skill applies the smallest fixes, rechecks only the specific failures to verify, and
stamps its log. Other than the scoped lint in step 3, this skill does **not** run the test or
lint suites itself — if the test log is missing or stale, `/fix-tests` tells the user to re-run
the check task.

## Report

After all sub-skills have run, summarize per skill: what each fixed, what it skipped, and any
holdouts it flagged for the user to review.
