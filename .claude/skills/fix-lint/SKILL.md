---
name: fix-lint
disable-model-invocation: true
description: 'Fixes lint errors from logs/lint-errors.log (written by the Lint: Everything task).'
---

# Skill: Fix Lint Errors

> **Cross-environment.** Reads `logs/lint-errors.log`, which is produced by either
> the local **Lint: Everything** VS Code task (desktop) or the **On-Demand Lint + Test**
> GitHub Actions workflow (mobile). Open the PR created by that workflow, then run this skill.

Fix actionable lint errors collected in `logs/lint-errors.log`.

---

## Step 1 — Collect & Match Known Fixes

Read these two files **in parallel** (single tool call):

- `logs/lint-errors.log`
- `.claude/skills/fix-lint/known-fixes.md`

If the log file does not exist or is empty, tell the user to run the **Lint: Everything**
task first, then stop.

### Addressed check

If the last line of `logs/lint-errors.log` is `--- ADDRESSED`, the errors have already
been fixed. Tell the user:

> These lint errors were already addressed. Re-run the **Lint: Everything** task and
> invoke `/fix-lint` again if new errors appear.

Then **stop**.

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| A section body is only `(exit code indicated failure but no parseable error lines...` | The script's output filter for that tool captured nothing — tool output format may have changed |
| A `# toolname` section has errors but **no** `file:line` pattern on any line | Errors are not self-locating — the agent cannot find the source without guessing |

If **any** quality problem is found:

1. Identify which linter(s) are affected.
2. Update `scripts/lint-all.ps1` to broaden the filter for those linters (switch to
   `--output-format=full`, `-f parsable`, or widen the `Where-Object` regex for that section).
3. Tell the user: what was wrong, what was changed, and ask them to re-run the
   **Lint: Everything** task.
4. **Stop** — do not attempt fixes on a low-quality log.

### Known-fix matching (mandatory — do this BEFORE any other file reads)

For every error in the log, check if any **Error pattern** substring from
`known-fixes.md` matches the rule code or error message.

**If a known fix matches: apply it immediately as a one-shot fix.** Do not read
additional files to re-derive the solution. Just apply the documented fix, increment
the **Hits** column by 1, set **Last used** to today's date, and move on.

Only proceed to Step 2 for errors that have **no known-fix match**.

### Triage unmatched errors

Build a short list of `file:line:rule` entries from sections prefixed with `# toolname`
headers (`# ruff`, `# eslint`, `# tsc`, `# stylelint`, `# markdownlint`, `# bandit`).

Bandit findings appear as `>> Issue: [CODE] message` + `Location: file:line:col` pairs —
treat each `Location:` line as the actionable pointer.

---

## Step 2 — Fix (unmatched errors only)

Skip this step entirely if all errors were resolved by known fixes in Step 1.

### Applying fixes

For each error:

1. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
2. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
3. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable errors, append `--- ADDRESSED` to the end of
`logs/lint-errors.log`.

### Update known-fixes table

After all fixes are applied, if any error **was not already covered** by a row in
`known-fixes.md` and its pattern is likely to recur (not a one-off typo), append a new
row to `.claude/skills/fix-lint/known-fixes.md` with:

- **Error pattern** — the rule code or shortest distinctive substring
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

### Prune stale entries

Delete rows where **Hits = 0** and **Added** is more than 90 days ago.

### Stop conditions

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Report

State clearly:

- Which errors were fixed (file, line, what changed).
- Which were skipped and why.
- Next step: re-run **Lint: Everything** if fixes were applied.

Diagnose from `logs/lint-errors.log`. After a fix you may re-run the single linter on the file you
changed (e.g. `ruff check <file>`, `mypy <file>`) to confirm it clears — don't re-run the full
**Lint: Everything** task; that stays the user's to run.

---

## Where to look by fix hint

| Fix hint keyword | File to open first |
|---|---|
| S603, S607 | `scripts/hooks/archive-session-copilot.py` |
| CVE- / pip-audit | `requirements.txt` |

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. One error = one minimal fix. Do not restructure surrounding code.
3. After a fix, run at most the single linter on the file you changed to verify — never re-run the
   full **Lint: Everything** task or dump raw output.
4. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run linting first.
5. Only stamp the log after applying at least one code fix.
6. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
7. **Log quality gate is mandatory.** If any section has no self-locating error lines, update
   `scripts/lint-all.ps1` and stop — never attempt fixes on a low-quality log.
