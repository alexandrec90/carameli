---
name: fix-pre-commit
description: 'Fix pre-commit hook errors from logs/pre-commit-errors.log (written by the git pre-commit hook or the Pre-Commit: Run All Hooks task).'
argument-hint: '(no arguments)'
---

# Skill: Fix Pre-Commit Errors

Fix hook errors collected in `logs/pre-commit-errors.log`.

---

## Step 1 — Collect Errors

Read `logs/pre-commit-errors.log` with the Read tool. If the file does not exist or is empty,
tell the user to either attempt a commit (the git hook writes the artifact automatically) or
run the `Pre-Commit: Run All Hooks` task first, then stop.

The file contains the output of failed pre-commit hooks. Each failed hook is identified by a
line ending in `Failed` (e.g. `ruff......Failed`). The actionable error output follows
immediately after each failed hook header until the next hook header or end of file.

Build a triage list grouping errors by hook:

| # | Hook | File:line | Error summary |
|---|------|-----------|---------------|
| 1 | ruff | app/main.py:12:1 | F401 unused import |
| 2 | bandit | app/core/auth.py:30 | B105 hardcoded password |
| 3 | detect-secrets | .env.example:5 | Hex high-entropy string |

### Hook-specific parsing

- **ruff**: lines matching `file:line:col: CODE message`
- **ruff-format**: files listed as reformatted (already auto-fixed — note and move on)
- **bandit**: `>> Issue: [CODE] message` + `Location: file:line:col` pairs
- **detect-secrets**: lines referencing file paths with potential secrets
- **eslint**: lines matching `file  line:col  error|warning  message  rule`
- **stylelint**: lines matching `file:line:col  error|warning  message`
- **markdownlint**: lines matching `file:line:col CODE/message`
- **dotenv-linter**: lines referencing `.env` files with the violation description

---

## Step 2 — Apply Fixes

For each error:

1. Open the relevant file and read enough context to understand the cause.
2. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
3. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
4. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

### Hook-specific guidance

- **ruff / eslint / stylelint / markdownlint**: straightforward code fixes.
- **ruff-format**: if the hook already auto-fixed files, just note them as resolved.
- **bandit**: security findings — apply the safe fix (e.g. replace hardcoded secret with
  env var lookup). If the finding is a false positive, add a `# nosec BXXX` comment with
  a brief justification.
- **detect-secrets**: if the finding is a real secret, remove it and use an env var. If it
  is a false positive, run `detect-secrets scan > .secrets.baseline` to update the baseline,
  or add an inline `# pragma: allowlist secret` comment with justification.
- **dotenv-linter**: fix formatting/ordering issues in `.env` files.

**Stop conditions:**

- A fix would require a non-trivial refactor — propose a minimal safe fix and ask for
  confirmation.
- Required context is missing — ask a single clarifying question and stop.

---

## Step 3 — Verify

Tell the user to re-run the `Pre-Commit: Run All Hooks` task or attempt a commit, then
invoke `/fix-pre-commit` again to catch any newly surfaced errors. Repeat until
`logs/pre-commit-errors.log` is empty.

Never run additional diagnostics after edits — instruct the user to rerun the task.

---

## Step 4 — Report

State clearly:

- Which errors were fixed (hook, file, line, what changed).
- Which were skipped and why.
- Next step: re-run `Pre-Commit: Run All Hooks` if fixes were applied.

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. Never run additional diagnostics after edits — instruct user to rerun the task.
3. One error = one minimal fix. Do not restructure surrounding code.
