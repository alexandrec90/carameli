---
name: fix-logs
disable-model-invocation: true
description: 'Fixes runtime errors from logs/log-errors.log (written by the Log: Extract Errors task).'
argument-hint: '"backend" | "frontend" | "known-only" — optional scope filter'
---

# Skill: Fix Log Errors

Fix code bugs surfaced in `logs/log-errors.log` (runtime ERROR/WARNING entries).

---

## Step 1 — Collect & Match Known Fixes

Read these two files **in parallel** (single tool call):

- `logs/log-errors.log`
- `.claude/skills/fix-logs/known-fixes.md`

If the log file does not exist or is empty, tell the user to run the **Log: Extract
Errors** task first, then stop.

### Addressed check

If the last line of `logs/log-errors.log` is `--- ADDRESSED`, the errors have already
been fixed. Tell the user:

> These log errors were already addressed. Re-run the **Log: Extract Errors** task
> and invoke `/fix-logs` again if new errors appear.

Then **stop**.

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| Lines that don't match `YYYY-MM-DD HH:MM:SS.mmm \| LEVEL \| module.path:lineno \| message` | Extractor captured raw/malformed lines — cannot map to source files |
| `INFO` or `DEBUG` level lines are present | Level filter didn't work — log contains noise that should have been dropped |
| Module path field is blank (e.g., `\|  \|` or `\| \|` with empty middle segment) | Module missing — cannot locate source file |

If **any** quality problem is found:

1. Identify which pattern is broken.
2. Update `scripts/extract-log-errors.ps1` to fix the level filter or format parser.
3. Tell the user: what was wrong, what was changed, and ask them to re-run the
   **Log: Extract Errors** task.
4. **Stop** — do not attempt fixes on a low-quality log.

### Known-fix matching (mandatory — do this BEFORE any other file reads)

For every error in the log, check if any **Error pattern** substring from
`known-fixes.md` appears in the error message or traceback.

**If a known fix matches: apply it immediately as a one-shot fix.** Do not read
additional files to re-derive the solution. Just apply the documented fix, increment
the **Hits** column by 1, set **Last used** to today's date, and move on.

Only proceed to Step 2 for errors that have **no known-fix match**.

### known-only mode

If the argument is `known-only`, stop here after applying matched fixes:

- Apply fixes for all matched errors. Update **Hits** and **Last used**.
- If **all** errors matched: stamp `--- ADDRESSED` and report normally. Done.
- If **any** errors are unmatched: **rewrite the log with only the unmatched errors**,
  then stop. The expensive model reads the trimmed log and sees only what remains.

Do not proceed to Step 2 under any circumstances when `known-only` is set.

### Triage unmatched errors

The log format is:

```text
YYYY-MM-DD HH:MM:SS.mmm | LEVEL    | module.path:lineno | message
```

Convert module path to file: `app.api.vsapi.phone_lines:56` → `app/api/vsapi/phone_lines.py`
line 56. `[FRONTEND]` entries originate in `frontend/src/` — check the `context=` field.

Build a triage table classifying each entry as **code bug** / **config issue** /
**transient external failure**. Only code bugs get fixed. Config issues are reported.
Transient failures are noted and skipped.

### Scope filter

If the argument contains `backend`, only fix errors whose module path starts with `app/`.
If the argument contains `frontend`, only fix `[FRONTEND]` entries.

---

## Step 2 — Diagnose & Fix (unmatched code bugs only)

Skip this step entirely if all errors were resolved by known fixes in Step 1.

### Applying fixes

For each code bug:

1. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
2. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
3. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable errors, append `--- ADDRESSED` to the end of
`logs/log-errors.log`.

### Update known-fixes table

After all fixes are applied, if any error **was not already covered** by a row in
`known-fixes.md` and its pattern is likely to recur, append a new row to
`.claude/skills/fix-logs/known-fixes.md` with:

- **Error pattern** — shortest distinctive substring from the error/traceback
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add entries for one-off or transient errors.

### Prune stale entries

Delete rows where **Hits = 0** and **Added** is more than 90 days ago.

### Stop conditions

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Report

State clearly:

- Which errors were fixed (file, line, what changed).
- Which were skipped (transient / config / blocked).
- **Restart reminder:** If any source files under `app/` were changed, tell the user:

  ```sh
  docker compose restart app
  ```

- Next step: re-run tests + extract errors if fixes were applied.

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. Never force-fix transient external failures (provider 5xx, DB timeouts).
3. Never modify source files in response to config issues — report them instead.
4. One error = one minimal fix. Do not restructure surrounding code.
5. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run extraction first.
6. Only stamp the log after applying at least one code fix.
7. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
8. **Log quality gate is mandatory.** Lines without a `module.path:lineno` field cannot be
   fixed — update `scripts/extract-log-errors.ps1` and stop.
9. **known-only mode: never investigate.** When `known-only` is set, do not proceed past
    Step 1. Rewrite the log with only the unmatched errors, then stop. The expensive model
    reads the trimmed log as-is.
