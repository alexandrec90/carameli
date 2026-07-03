---
name: fix-tests
# No disable-model-invocation: this skill is invoked programmatically by /fix-all
# via the Skill tool. See .claude/rules/authoring.md (orchestrated sub-skill exception).
description: 'Fixes test failures collected in logs/test-failures.log.'
---

# Skill: Fix Test Failures

Fix the failing tests recorded in `logs/test-failures.log`. That log is written by the
check-run script (`scripts/run-tests.py`) whenever the suite runs — **this skill never runs
the full suite itself.** It reads the log, fixes the implicated code, and reruns only the
specific failed tests to confirm.

> **Verifying needs the local Docker stack.** Reading the log and applying fixes works
> without it, but confirming a fix reruns tests via `docker compose exec`. If Docker isn't
> up, apply the fix, stamp the log, and tell the user to bring the stack up (or re-run the
> check script) to verify.

## Step 1 — Read the log + known fixes (first action, in parallel)

Read `logs/test-failures.log` and `.claude/skills/fix-tests/known-fixes.md` in a **single
parallel call** before anything else. Then act on the log's state:

| Log state | Action |
|---|---|
| Empty | Tests are green — stop. |
| Last line is `--- ADDRESSED`, or file missing | Stale/ungenerated — tell the user to re-run the check run (`scripts/run-tests.py`), then stop. Don't run the suite yourself. |
| Non-empty, last line ≠ `--- ADDRESSED` | Fresh — proceed below. |

**Log-quality gate (mandatory).** If any failure block carries the
`[raw fallback: no E-lines in filtered output]` marker, or has no `E` lines and no
`app/`/`tests/` frame, or a `FAILED`/`ERROR` summary line has no matching `___` block — the
traceback was stripped and the cause is invisible. Do **not** guess-fix source. Widen the
filter in `scripts/diagnostics.py` (`filter_pytest_output`), update
`scripts/hooks/tests/test_diagnostics.py` in the same edit, then tell the user to regenerate
the log. The `# source:` header names the runner.

**Noise gate (mandatory — the inverse).** The log must hold *only* actionable failures. If the
real failures (`FAILED` / `×` lines and their tracebacks) are buried under content an agent can't
act on — passing-test lines (`✓` / `PASSED`), repeated React `act(...)` warnings, expected
`[WARN]`/INFO captures, or `PytestWarning` summary lines that survive only because they embed a
`tests/…py:NN` substring — the filter is leaking noise (see `.claude/rules/diagnostics.md` §2:
no passing results; keep WARNING+ captures only). Don't wade through it to find the few real
failures. **Tighten** the filter in `scripts/diagnostics.py` — `filter_pytest_output` for the
pytest sources, or add a vitest equivalent for the `frontend-tests` source (it currently parses
with the generic `denoise`, which passes `✓`/warning lines straight through). Update
`scripts/hooks/tests/test_diagnostics.py` in the same edit, then tell the user to regenerate the
log.

**Known-fix short-circuit (mandatory).** For each failure, if any `known-fixes.md` pattern
substring appears in the traceback/error line, apply that documented fix immediately — no
extra reads, no re-derivation. Bump the row's **Hits** and set **Last used** to today.

## Step 2 — Fix the remaining failures

For each failure with no known-fix match, apply the **smallest** fix that resolves it — no
refactors, no unrelated cleanup. Preserve existing `logger.*` calls; add any missing per
`.claude/rules/logging.md`. If a fix needs a DB schema change, stop and use `/add-db-model`.

After applying at least one fix, append `--- ADDRESSED` to `logs/test-failures.log`. Add a
`known-fixes.md` row for any new pattern likely to recur (Error pattern / Root cause / Fix /
Hits `1` / Last used / Added — dates today); prune zero-hit rows older than 90 days.

## Step 3 — Verify, then report

Rerun **only the specific failed tests** to confirm — never the whole suite (the check-run
script owns that):

- pytest: `docker compose exec -T app pytest <node-id> <node-id> … -p no:cacheprovider -q --no-header`
  (after `app/` edits, `docker compose restart app` first; test-only edits need no restart).
- frontend (vitest): `docker compose exec -T frontend npx vitest run <file>`.

After a `docker compose restart app`, if the rerun errors on a container/connection failure
instead of a test assertion, a bad `app/` edit likely broke startup — check
`docker compose ps`, and if `app` is unhealthy/exited/restarting, run
`python scripts/docker-status.py` to refresh the `logs/docker/` artifacts with the current
failure, then invoke `/fix-docker` — rather than treating it as a test failure. Refreshing
first matters: `/fix-docker` skips any `logs/docker/` artifact stamped `--- ADDRESSED` from a
prior pass, so without a regenerate it may triage stale state instead of the startup break you
just caused.

If a rerun still fails, fix and rerun those same tests again — up to **4 rounds**, stopping
early if a round ends with the same failures it began with (report the holdouts rather than
spinning). If Docker isn't up, skip the rerun: report the fixes you applied and tell the user
to bring up the stack (or re-run the check script) to verify.

Then report: which failures were fixed (file, test, what changed) and, for anything not
fixed, the evidence-backed report described in Hard Rule 3 — never a bare "skipped".

## Hard Rules (anti-spiral guard)

1. **Diagnosis budget: 6 targeted runs per failure.** Probe/repro tests, targeted reruns,
   and experiment edits all count toward the budget; the Step-3 verify reruns of an applied
   fix do not. Hitting the budget without a verified fix means stop and apply rule 3 — never
   keep bisecting past it, and never resume the same dead-end diagnosis after a context
   compaction.
2. **Never skip, never relax, never appease.** Do not mark a failing test skip/xfail. Do
   not delete a test — removing coverage is the user's call, made via a rule-3 report. Do
   not edit application code that behaves as intended just to quiet a runner. A test file
   may be edited only when evidence *outside the test* shows its expectation is wrong —
   the spec/contract, a deliberate behavior change in this branch, a documented API
   change — and the report must cite that evidence. An edit that only weakens an
   assertion (widens a matcher, drops a check, raises a tolerance) is presumed
   appeasement: if you can't show the expectation was wrong, leave the test red and write
   the rule-3 report instead.
3. **Blocked → report with suggestions, don't bury.** When the budget is hit, or a fix needs
   a decision that isn't this skill's to make (dependency upgrade, test-runner bug, design
   change), stop and report to the user: the failure, the evidence gathered, what was ruled
   out, and 2–3 concrete options with a recommendation. Leaving the failure red with that
   report is the correct terminal state — silently moving on, or a "not a code bug" shrug
   with no proposed path to green, is not.
4. **A flip is a diff, not chaos.** When a test passes/fails depending on a seemingly
   irrelevant difference (in-file position, an edit that "shouldn't matter"), take the
   smallest passing and failing variants and diff them byte-by-byte, then minimize the
   difference — that diff usually *is* the root cause (canonical case: known-fixes row
   "implicit-return `beforeEach`", where `() => mock.mockReset()` vs `() => { … }` was the
   whole bug). Declaring the behavior nondeterministic without that diff is a budget-burner.
