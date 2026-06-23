---
name: fix-tests
disable-model-invocation: true
description: 'Fixes test failures from logs/test-failures.log (written by the Test: Run pytest task).'
---

# Skill: Fix Test Failures

> **Cross-environment.** Reads `logs/test-failures.log`, which is produced by either
> the local **Test: Run pytest** VS Code task (desktop) or the **On-Demand Lint + Test**
> GitHub Actions workflow (mobile). Open the PR created by that workflow, then run this skill.

Fix failing tests collected in `logs/test-failures.log`.

The fix steps are the same everywhere — read the log, edit the implicated code. One thing
differs by environment, and only after you change a file under `app/`:

- **Running locally:** the app runs from a container, so the change isn't live until
  `docker compose restart app`. Test-only edits need no restart.
- **In CI** (working a `fix/auto-*` PR branch): each run rebuilds from scratch and runs
  `alembic upgrade head` before tests, so any code or migration change takes effect on the
  next push. There's nothing to restart.

Don't over-think this up front: if there's no Docker daemon, you're not running locally —
there's nothing for you to restart, so just fix the code (the next push or runner handles
making it live; see Step 3).

---

## Step 1 — Collect & Match Known Fixes

> **MANDATORY FIRST ACTION**: Read `logs/test-failures.log` and
> `known-fixes.md` in a single parallel call before doing anything else.
> Skipping this step violates the hard rules.

Read these two files **in parallel** (single tool call):

- `logs/test-failures.log`
- `.claude/skills/fix-tests/known-fixes.md`

**Decide what to do based on what you just read — do not run any test command before checking:**

| Log state | Action |
|---|---|
| Non-empty, last line is NOT `--- ADDRESSED` | **Fresh** — proceed to known-fix matching below. **Do not re-run any test command.** |
| Empty | Tests are green — stop. |
| Last line is `--- ADDRESSED` | **Stale** — regenerate it (desktop: restart app if `app/` changed, then re-run **Test: Run pytest**; CI: push and let the workflow re-run). Stop this turn; restart on the fresh log. |
| File doesn't exist | Not yet generated — generate it (desktop: run **Test: Run pytest**; CI: the workflow produces it). Stop this turn; restart on the fresh log once present. |

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| `[raw fallback: no E-lines in filtered output]` in a failure block | The script's filter stripped the actionable lines — the block is noise without signal |
| A failure block has **no** `E` lines AND **no** `app/` or `tests/` frame | The traceback was filtered out entirely — root cause is invisible |
| A `FAILED` test appears in the short-test-summary but has **no** corresponding `___` block | The failure body was never captured |

If **any** quality problem is found:

1. Identify which test(s) are affected and which output pattern was lost.
2. Relax the relevant filter in the script named on the log's `# source:` header — widen
   the line-keep conditions, raise the per-block cap, or preserve the missing frame pattern.
   `run-tests.ps1` (`Invoke-FlushBlock`) and `ci-digest.py` (`filter_pytest_output`) share
   this logic — if you change one, change the other to match.
3. Note what was wrong and what you changed, then regenerate the log with the improved
   filter (desktop: re-run **Test: Run pytest**; CI: push) and restart from Step 1 on the
   higher-quality output.
4. Do not attempt fixes on the current low-quality log — fix the filter first.

### Known-fix matching (mandatory — do this BEFORE any other file reads)

For every failure in the log, check if any **Error pattern** substring from
`known-fixes.md` appears in the traceback or error line.

**If a known fix matches: apply it immediately as a one-shot fix.** Do not read
additional files to re-derive the solution. Just apply the documented fix, increment
the **Hits** column by 1, set **Last used** to today's date, and move on to the next
failure.

Only proceed to Step 2 for failures that have **no known-fix match**.

### Triage unmatched failures

For any failure not matched by a known fix, collect lines starting with `FAILED` or
`ERROR` and the traceback immediately following each. Build a triage list.

---

## Step 2 — Diagnose & Fix (unmatched failures only)

Skip this step entirely if all failures were resolved by known fixes in Step 1.

### Applying fixes

For each failure:

1. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
2. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
3. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable failures, append `--- ADDRESSED` to the end of
`logs/test-failures.log`.

### Update known-fixes table

After all fixes are applied, if any failure **was not already covered** by a row in
`known-fixes.md` and its error pattern is likely to recur, append a new row with:

- **Error pattern** — shortest distinctive substring from the traceback/error line
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add entries for one-off mistakes.

### Prune stale entries

While editing `known-fixes.md`, delete rows where **Hits = 0** and **Added** is more
than 90 days ago.

### Stop conditions

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Report

State clearly:

- Which failures were fixed (file, test name, what changed).
- Which were skipped and why (only genuine stop conditions).

Your deliverable is the **fix plus the `--- ADDRESSED` stamp** — that needs no test runner
and completes in any environment (including a headless eval that only seeds the log).

**If a runner is reachable, close the loop yourself:** make `app/` changes live (locally
`docker compose restart app`; in CI the next push handles it — see the intro), regenerate
the log, and repeat from Step 1 until it's empty. Don't stop at a half-fixed state and wait
for a human. **If no runner is reachable** (no Docker and not a CI workflow branch — e.g. a
sandbox), you can't regenerate: finish the fix, stamp `--- ADDRESSED`, report, and stop.
Whatever runs the suite next produces the fresh log.

> When you do regenerate locally, the suite streams every test line — don't pipe that into
> context; discard the run's stdout and read the capped `logs/test-failures.log` instead
> (background a slow run so the turn isn't blocked). Waiting on pytest costs latency, not
> tokens; ingesting its raw output is what costs tokens. In CI you skip this entirely.

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Rerun selectively — never the whole suite to verify a fix.** You already have the failed
   node IDs from the log; after a fix, rerun exactly those
   (`docker compose exec -T app pytest tests/...::test_a tests/...::test_b`). To gate a pass
   against regressions, use the changed-only run (the **Fast** task / `run-tests.ps1 -Fast`,
   i.e. testmon) — it reruns just the tests your edits touched, including any previously-passing
   one your fix breaks. Reserve a cold full suite for when the testmon graph looks stale.
4. If the log is stamped `--- ADDRESSED`, it's stale — regenerate it before fixing (don't fix
   against a stale log).
5. Only stamp the log after applying at least one code fix.
6. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
7. **Log quality gate is mandatory.** If any failure block has no traceback (no `E` lines,
   no `app/`/`tests/` frames), update the producing filter (named on the log's `# source:`
   header) and stop — never attempt fixes on a log where the root cause is invisible.
