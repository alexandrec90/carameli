---
name: fix-lint
description: 'Fixes lint errors from logs/lint-errors.log (written by the Lint: Everything task).'
argument-hint: '(no arguments)'
---

# Skill: Fix Lint Errors

Fix actionable lint errors collected in `logs/lint-errors.log`.

---

## Step 1 — Collect Errors

Read `logs/lint-errors.log` with the Read tool. If the file does not exist or is empty,
tell the user to run the `Lint: Everything` task first, then stop.

### Addressed check

If the last line of `logs/lint-errors.log` is `--- ADDRESSED`, the errors in this file
have already been fixed in a prior run and the user has not re-run the lint task since.
Tell the user:

> These lint errors were already addressed. Re-run the **Lint: Everything** task and
> invoke `/fix-lint` again if new errors appear.

Then **stop** — do not re-triage or re-fix anything.

The `Lint: Everything` task overwrites the entire file on each run, so the marker is
naturally cleared whenever the user re-runs linting.

### Triage

If the file is **not** addressed, build a short list of `file:line:rule` entries.

The file contains only actionable error lines (passing tools write nothing). Sections are
prefixed with `# toolname` headers (`# ruff`, `# eslint`, `# tsc`, `# stylelint`,
`# markdownlint`, `# bandit`). Collect lines matching `file:line:col: CODE message`
format. Ignore `# toolname` headers.

Bandit findings appear under `# bandit` as `>> Issue: [CODE] message` + `Location: file:line:col`
pairs — treat each `Location:` line as the actionable pointer.

---

## Step 2 — Apply Fixes

For each error:

1. Open the relevant file and read enough context to understand the cause.
2. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
3. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
4. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable errors, append the line `--- ADDRESSED` to the end of
`logs/lint-errors.log` using the Edit tool. This prevents the same errors from being
re-triaged on the next `/fix-lint` invocation. (The marker is cleared automatically
when the `Lint: Everything` task overwrites the file.)

**Stop conditions:**

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask for
  confirmation.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Verify

Tell the user to re-run the `Lint: Everything` task, then invoke `/fix-lint` again
to catch any newly surfaced errors. Repeat until `logs/lint-errors.log` is empty.

Never run additional diagnostics after edits — instruct the user to rerun the task.

---

## Step 4 — Report

State clearly:

- Which errors were fixed (file, line, what changed).
- Which were skipped and why.
- Next step: re-run `Lint: Everything` if fixes were applied.

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. Never run additional diagnostics after edits — instruct user to rerun the task.
3. One error = one minimal fix. Do not restructure surrounding code.
4. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run linting first.
5. Only stamp the log after applying at least one code fix.
