---
name: fix-pester
disable-model-invocation: true
description: 'Fixes PowerShell Pester failures from logs/pester-failures.log (written by the Test: Run Pester (PowerShell) task). Use when the Pester runner artifact contains actionable script-test failures.'
---

# Skill: Fix Pester Failures

> **Local session only.** This skill reads log artifacts written by PS1 scripts
> on the host machine. It cannot run in web or mobile sessions.

Fix actionable PowerShell test failures collected in `logs/pester-failures.log`.

---

## Step 1 — Collect & Match Known Fixes

> **MANDATORY FIRST ACTION**: Read `logs/pester-failures.log` and
> `.claude/skills/fix-pester/known-fixes.md` in a single parallel call before doing anything else.

Read these two files **in parallel** (single tool call):

- `logs/pester-failures.log`
- `.claude/skills/fix-pester/known-fixes.md`

If the log file does not exist or is empty, tell the user to run the **Test: Run Pester (PowerShell)**
task first, then stop.

### Addressed check

If the last line of `logs/pester-failures.log` is `--- ADDRESSED`, the failures have
already been handled. Tell the user:

> These Pester failures were already addressed. Re-run the **Test: Run Pester (PowerShell)**
> task and invoke `/fix-pester` again if new failures appear.

Then **stop**.

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| The file has a `# pester` header but no `file:line:col` failure lines | The artifact is not self-locating |
| A failure line exists but has no `-- message` suffix | The assertion/context message was lost |
| The file contains only the fallback line `Pester reported a failure but returned no failed test details.` | The runner did not capture actionable failure details |

If **any** quality problem is found:

1. Update `scripts/run-pester.ps1` so the artifact includes self-locating failure lines and useful messages.
2. Tell the user what was missing and ask them to re-run the **Test: Run Pester (PowerShell)** task.
3. **Stop** — do not attempt fixes on a low-quality log.

### Known-fix matching (mandatory — do this BEFORE any other file reads)

For every failure in the log, check whether any **Error pattern** substring from
`known-fixes.md` matches the failure line or `stdout:` lines.

**If a known fix matches: apply it immediately as a one-shot fix.** Do not read
additional files to re-derive the solution. Apply the documented fix, increment the
**Hits** column by 1, set **Last used** to today's date, and continue.

Only proceed to Step 2 for failures with **no known-fix match**.

### Triage unmatched failures

Build a short list of actionable entries from lines like:

- `scripts/tests/foo.Tests.ps1:23:1: [Pester] suite.case -- assertion message`
- any immediately following `stdout:` lines

Treat the `file:line:col` location as the first file to inspect.

---

## Step 2 — Fix (unmatched failures only)

Skip this step entirely if all failures were resolved by known fixes in Step 1.

For each unmatched failure:

1. Apply the **smallest reasonable fix** in the implicated `.ps1` script or `*.Tests.ps1` file.
2. Keep the change tightly scoped to the reported failure.
3. If the failure indicates missing diagnostic context, fix `scripts/run-pester.ps1` instead of guessing.
4. If the fix would require a broad refactor, stop and ask.

**After fixing** all actionable failures, append `--- ADDRESSED` to the end of
`logs/pester-failures.log`.

### Update known-fixes table

After all fixes are applied, if a recurring failure pattern was **not already covered** and is likely
to recur, append a new row to `.claude/skills/fix-pester/known-fixes.md` with:

- **Error pattern** — shortest distinctive substring
- **Root cause** — one-line explanation
- **Fix** — the change that fixed it
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add rows for one-off typos or temporary environment issues.

### Prune stale entries

Delete rows where **Hits = 0** and **Added** is more than 90 days old.

---

## Step 3 — Report

State clearly:

- Which Pester failures were fixed
- Which files were changed
- Which failures were skipped and why
- Next step: re-run **Test: Run Pester (PowerShell)**

Never run Pester yourself after edits — instruct the user to re-run the task.

---

## Hard Rules

1. Read `logs/pester-failures.log` and `known-fixes.md` together before any other investigation.
2. If a known-fix pattern matches, apply it immediately without extra file reads.
3. Edit only files directly implicated by the failure artifact.
4. One failure = one minimal fix. No unrelated cleanup.
5. Skip already-addressed artifacts stamped `--- ADDRESSED`.
6. Only stamp the log after applying at least one code fix.
7. If the artifact is not self-locating, fix `scripts/run-pester.ps1` first and stop.
8. Never run additional diagnostics yourself after edits — tell the user to rerun the task.
