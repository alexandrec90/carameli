---
name: fix-logs
description: 'Fix runtime errors from logs/log-errors.log (written by the Log: Extract Errors task).'
argument-hint: '"backend" | "frontend" — optional scope filter'
---

# Skill: Fix Log Errors

Fix code bugs surfaced in `logs/log-errors.log` (runtime ERROR/WARNING entries).

---

## Step 1 — Collect Errors

Read `logs/log-errors.log` with the Read tool. If the file does not exist or is empty,
tell the user to run the `Log: Extract Errors` task first, then stop.

The file contains only ERROR and WARNING lines (with tracebacks) extracted from the
runtime log. Duplicates have already been collapsed. Build a triage table:

| # | Level | Module:line | Message summary | Action |
|---|---|---|---|---|
| 1 | ERROR | app.api.vsapi.phone_lines:56 | Provider error purchasing DID | Fix code |

Classify each entry as **code bug** / **config issue** / **transient external failure**.
Only code bugs get fixed. Config issues are reported clearly. Transient failures are noted
and skipped.

The log format is:

```text
YYYY-MM-DD HH:MM:SS.mmm | LEVEL    | module.path:lineno | message
```

Convert module path to file: `app.api.vsapi.phone_lines:56` → `app/api/vsapi/phone_lines.py` line 56.
`[FRONTEND]` entries originate in `frontend/src/` — check the `context=` field for the component.

### Scope filter

If the argument contains `backend`, only fix errors whose module path starts with `app/`.
If the argument contains `frontend`, only fix `[FRONTEND]` entries.

---

## Step 2 — Apply Fixes

For each code bug:

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

## Step 3 — Verify

Tell the user to re-run the `Test: Run pytest` task to exercise the code paths, then
re-run the `Log: Extract Errors` task. Invoke `/fix-logs` again if `logs/log-errors.log`
still contains code bugs.

---

## Step 4 — Report

State clearly:

- Which errors were fixed (file, line, what changed).
- Which were skipped (transient / config / blocked).
- Next step: re-run tests + extract errors if fixes were applied.

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. Never force-fix transient external failures (provider 5xx, DB timeouts).
3. Never modify source files in response to config issues — report them instead.
4. One error = one minimal fix. Do not restructure surrounding code.
