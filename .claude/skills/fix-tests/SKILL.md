---
name: fix-tests
disable-model-invocation: true
description: 'Fixes test failures from logs/test-failures.log (written by the Test: Run pytest task).'
---

# Skill: Fix Test Failures

> **Local session only.** This skill reads log artifacts written by PS1 scripts
> on the host machine. It cannot run in web or mobile sessions.

Fix failing tests collected in `logs/test-failures.log`.

---

## Step 1 — Collect & Match Known Fixes

> **MANDATORY FIRST ACTION**: Read `logs/test-failures.log` and
> `known-fixes.md` in a single parallel call before doing anything else.
> Skipping this step violates the hard rules.

Read these two files **in parallel** (single tool call):

- `logs/test-failures.log`
- `.claude/skills/fix-tests/known-fixes.md`

If the log file does not exist or is empty, tell the user to run the **Test: Run pytest**
task first, then stop.

### Addressed check

If the last line of `logs/test-failures.log` is `--- ADDRESSED`, the failures have
already been fixed. Tell the user:

> These failures were already addressed. Re-run the **Test: Run pytest** task
> (after `docker compose restart app` if `app/` files were changed) and invoke
> `/fix-tests` again if new failures appear.

Then **stop**.

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| `[raw fallback: no E-lines in filtered output]` in a failure block | The script's filter stripped the actionable lines — the block is noise without signal |
| A failure block has **no** `E` lines AND **no** `app/` or `tests/` frame | The traceback was filtered out entirely — root cause is invisible |
| A `FAILED` test appears in the short-test-summary but has **no** corresponding `___` block | The failure body was never captured |

If **any** quality problem is found:

1. Identify which test(s) are affected and which output pattern was lost.
2. Update `scripts/run-tests.ps1` to relax the relevant filter in `Invoke-FlushBlock`
   (e.g., widen the line-keep conditions, raise `$maxPerBlock`, or preserve the
   missing frame pattern).
3. Tell the user: what was wrong, what was changed, and ask them to re-run the
   **Test: Run pytest** task.
4. **Stop** — do not attempt fixes on a low-quality log.

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
- Which were skipped and why.
- **Restart reminder:** If any source files under `app/` were changed, tell the user:

  ```sh
  docker compose restart app
  ```

  If only test files were changed, no restart is needed.
- Tell the user to re-run the **Test: Run pytest** task and invoke `/fix-tests` again
  if failures remain.

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Diagnose from `logs/test-failures.log`, not by running the full suite.** After applying a
   fix you may run a single targeted check — `docker compose exec -T app pytest <path::to::the_test>`
   for just the test you fixed — to confirm it goes green. Do not run the whole suite or dump raw
   output; the full **Test: Run pytest** task remains the user's to re-run.
4. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run tests first.
5. Only stamp the log after applying at least one code fix.
6. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
7. **Log quality gate is mandatory.** If any failure block has no traceback (no `E` lines,
   no `app/`/`tests/` frames), update `scripts/run-tests.ps1` and stop — never attempt fixes
   on a log where the root cause is invisible.
