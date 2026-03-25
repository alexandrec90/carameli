---
name: fix-tests
description: 'Fixes test failures from logs/test-failures.log (written by the Test: Run pytest task).'
argument-hint: '(no arguments)'
---

# Skill: Fix Test Failures

Fix failing tests collected in `logs/test-failures.log`.

---

## Step 1 — Collect Failures

Read `logs/test-failures.log` with the Read tool. If the file does not exist or is empty,
tell the user to run the `Test: Run pytest` task first, then stop.

### Addressed check

If the last line of `logs/test-failures.log` is `--- ADDRESSED`, the failures in this file
have already been fixed in a prior run and the user has not re-run the test task since.
Tell the user:

> These failures were already addressed. Re-run the **Test: Run pytest** task
> (after `docker compose restart app` if `app/` files were changed) and invoke
> `/fix-tests` again if new failures appear.

Then **stop** — do not re-triage or re-fix anything.

The `Test: Run pytest` task overwrites the entire file on each run, so the marker is
naturally cleared whenever the user re-runs tests.

### Known-fix lookup

Before reasoning about each failure, read `.claude/skills/fix-tests/known-fixes.md`.
For every collected error, check if any **Error pattern** substring appears in the
traceback or error line. If a match is found, apply the documented fix directly as a
one-shot — do not re-derive the solution from scratch.

For every matched row, increment its **Hits** column by 1 and set **Last used** to
today's date (`YYYY-MM-DD`). Do this in the same Edit call that stamps
`--- ADDRESSED` — no extra tool call needed.

### Triage

If the file is **not** addressed, collect lines starting with `FAILED` or `ERROR` and the
traceback immediately following each. Build a triage list.

---

## Step 2 — Apply Fixes

For each failure:

1. Open the relevant file and read enough context to understand the cause.
2. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
3. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
4. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable failures, append the line `--- ADDRESSED` to the end of
`logs/test-failures.log` using the Edit tool. This prevents the same failures from being
re-triaged on the next `/fix-tests` invocation.

### Update known-fixes table

After all fixes are applied, review the failures you just fixed. If any failure
**was not already covered** by a row in `known-fixes.md` and its error pattern is
likely to recur (i.e., it is not a one-off typo), append a new row to the table in
`.claude/skills/fix-tests/known-fixes.md` with:

- **Error pattern** — the shortest distinctive substring from the traceback/error line
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add entries for unique, non-recurring mistakes (e.g., a misspelled variable
name in one test). Only add patterns that could plausibly appear again.

### Prune stale entries

While editing `known-fixes.md`, check for rows where **Hits = 0** and **Added** is
more than 90 days ago. Delete those rows — they were seeded but never matched a real
failure, so they just consume context tokens for no benefit.

**Stop conditions:**

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask for
  confirmation.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Report

State clearly:

- Which failures were fixed (file, test name, what changed).
- Which were skipped and why.
- **Restart reminder:** If any source files under `app/` were changed, the Docker container
  is still running the old code. Tell the user to restart the app container before re-running
  tests:

  ```sh
  docker compose restart app
  ```

  If only test files (under `tests/`) were changed, no restart is needed.
- Tell the user to re-run the `Test: Run pytest` task and then invoke `/fix-tests` again if
  failures remain.

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Never run tests yourself.** Do not invoke `pytest`, `docker compose exec`, or any test
   runner command. All test execution is done by the user via the VS Code task.
4. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run tests first.
5. Only stamp the log after applying at least one code fix.
