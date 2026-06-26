---
name: fix-lint
disable-model-invocation: true
description: 'Fixes lint errors collected in logs/lint-errors.log.'
---

# Skill: Fix Lint Errors

> **Cross-environment.** Reads `logs/lint-errors.log`, produced whenever the lint suite
> runs — locally during a check run, or in CI by the On-Demand Lint + Test workflow (open
> the PR it creates, then run this skill). Fixing works the same either way.

Fix actionable lint errors collected in `logs/lint-errors.log`. Lint fixes are plain
source edits — identical in every environment.

**Drive it to green — don't hand a half-fixed state back to a human.** Fix everything in
the log, then regenerate it and keep going until it's empty. If the linter toolchain is
available, re-run the lint suite yourself (it overwrites the log) and loop on what's left.
If it isn't (sandbox / no toolchain), push on a `fix/auto-*` branch or ask the user.
Do not infer toolchain availability from the branch name — check directly.

This is a verify-and-loop *between* passes, not per edit — while fixing a batch, diagnose
from the log and use targeted single-file rechecks (below), not full re-runs.

---

## Step 1 — Collect & Match Known Fixes

Read these two files **in parallel** (single tool call):

- `logs/lint-errors.log`
- `.claude/skills/fix-lint/known-fixes.md`

**Decide what to do based on what you just read — do not run any linter before checking:**

| Log state | Action |
|---|---|
| Non-empty, last line is NOT `--- ADDRESSED` | **Fresh** — proceed to known-fix matching below. **Do not re-run any linter.** |
| Empty | Lint is green — stop. |
| Last line is `--- ADDRESSED` | **Stale** — regenerate it. If linters are available locally: re-run the lint suite yourself. If not (no toolchain / sandbox): push on a `fix/auto-*` branch or ask the user. Stop this turn; restart on the fresh log. |
| File doesn't exist | Not yet generated — generate it. If linters are available locally: run the lint suite yourself. If not: push on a `fix/auto-*` branch or ask the user. Stop this turn; restart on the fresh log once present. |

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| A section body is only `(exit code indicated failure but no parseable error lines...` | The script's output filter for that tool captured nothing — tool output format may have changed |
| A `# toolname` section has errors but **no** `file:line` pattern on any line | Errors are not self-locating — the agent cannot find the source without guessing |

If **any** quality problem is found:

1. Identify which linter(s) are affected.
2. Broaden the filter in `scripts/diagnostics.py` (the `LINT_SECTIONS` keep-functions), or
   widen the tool's own output in the runner named on the log's `# source:` header (switch to
   `--output-format=full`, `-f parsable`). The `diagnostics.py` filter is shared by the local
   task and CI, so one change covers both. Update `scripts/hooks/tests/test_diagnostics.py`
   in the same edit.
3. Note what was wrong and what you changed, then regenerate the log with the improved
   filter (locally: re-run the lint suite; CI: push) and restart from Step 1 on the
   higher-quality output.
4. Do not attempt fixes on the current low-quality log — fix the filter first.

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
- Which were skipped and why (only genuine stop conditions — a known refactor or missing context).

Your deliverable is the **fix plus the `--- ADDRESSED` stamp** — that needs no linter run
and completes in any environment (including a headless eval that only seeds the log).

**If linters are available locally, close the loop yourself:** re-run the lint suite to
regenerate the log and repeat from Step 1 until it's empty. While fixing a batch,
diagnose from `logs/lint-errors.log` and use targeted single-file rechecks (e.g.
`ruff check <file>`, `mypy <file>`) to confirm individual fixes — the full re-run is the
once-per-pass verify, not a per-edit habit. **If linters are not available** (sandbox /
no toolchain), finish the fixes, stamp `--- ADDRESSED`, report, and stop. Do not infer
toolchain availability from the branch name — check directly.

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
3. While fixing a batch, verify with targeted single-file rechecks — don't brute-force the
   full lint suite after every edit. Re-run the full diagnostic once per pass to confirm and
   loop, not per fix.
4. If the log is stamped `--- ADDRESSED`, it's stale — regenerate it before fixing (don't fix
   against a stale log).
5. Only stamp the log after applying at least one code fix.
6. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
7. **Log quality gate is mandatory.** If any section has no self-locating error lines, update
   the producing filter (named on the log's `# source:` header) and stop — never attempt
   fixes on a low-quality log.
