---
name: fix-tests
description: 'Fix test failures from logs/test-failures.log (written by the Test: Run pytest task).'
argument-hint: '(no arguments)'
---

# Skill: Fix Test Failures

Fix failing tests collected in `logs/test-failures.log`.

---

## Step 1 — Collect Failures

Read `logs/test-failures.log` with the Read tool. If the file does not exist or is empty,
tell the user to run the `Test: Run pytest` task first, then stop.

The file contains only the failures section (everything from the first `FAILED`/`ERRORS`
block onward). Collect lines starting with `FAILED` or `ERROR` and the traceback
immediately following each. Build a triage list.

---

## Step 2 — Apply Fixes

For each failure:

1. Open the relevant file and read enough context to understand the cause.
2. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
3. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
4. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**Stop conditions:**
- A fix would require a non-trivial refactor → propose a minimal safe fix and ask for
  confirmation.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Report

State clearly:
- Which failures were fixed (file, test name, what changed).
- Which were skipped and why.
- Tell the user to re-run the `Test: Run pytest` task and then invoke `/fix-tests` again if
  failures remain.

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Never run tests yourself.** Do not invoke `pytest`, `docker compose exec`, or any test
   runner command. All test execution is done by the user via the VS Code task.
