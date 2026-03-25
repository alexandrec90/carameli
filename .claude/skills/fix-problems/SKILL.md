---
name: fix-problems
description: 'Fixes errors and warnings shown in the VS Code Problems panel (Pylance, TypeScript, ESLint, etc.) by reading live diagnostics and applying fixes in a single pass. Use when the Problems panel has entries to clear, or when asked to fix diagnostics or type errors.'
argument-hint: 'optional file path or glob to scope which problems to fix'
---

# Skill: Fix Problems Panel

Fix diagnostics surfaced in the VS Code Problems panel in a **single pass**. After fixes
are applied, the user must accept changes (Keep) before the Problems panel refreshes —
so re-checking happens in a follow-up invocation if needed, not in the same run.

---

## Step 1 — Collect Problems

Call `get_errors` with no arguments to fetch all current diagnostics. If an argument was
provided (file path or glob), pass it as the `filePaths` array to scope the check.

If **no errors or warnings** are returned, tell the user the Problems panel is clean and
stop.

Build a triage table:

| # | Severity | File:line | Code | Message |
|---|----------|-----------|------|---------|
| 1 | error    | app/api/vsapi/sms.py:34 | reportMissingImport | … |
| 2 | warning  | frontend/src/hooks/useDashboard.ts:12 | TS2345 | … |

---

## Step 2 — Classify Each Problem

Before fixing, classify every problem:

- **Fixable** — a code change in the workspace will clear it (type errors, missing
  imports, unused variables, wrong argument counts, lint rule violations, etc.).
- **Config/env issue** — requires a user action outside the editor (missing npm package,
  missing pip package, wrong env var, extension not installed, unknown tool reference in
  an agent file, etc.). Note these separately; do not attempt to fix them in code.
- **External / unfixable** — error originates from generated code, a third-party file, or
  a tool schema the agent cannot influence. Note and skip.

---

## Step 3 — Apply Fixes

For each **Fixable** problem:

1. Read the file at the indicated line plus enough surrounding context to understand the
   cause.
2. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
3. Preserve all existing `logger.*` calls.
4. If a fix requires a DB schema change, stop and tell the user to use `/add-db-model`.
5. If a fix requires a non-trivial refactor, propose the minimal safe change, ask for
   confirmation, and stop — do not continue to other problems until the user responds.

---

## Step 4 — Report

Always close with a structured summary:

```text
Fixed (N):
  - file:line — what was changed

Outstanding (M):
  - file:line [code] — reason not fixed / action required
```

If all problems are cleared, tell the user to **Keep** the changes and check the Problems
panel — if new issues surface from the fixes, invoke `/fix-problems` again.

If there are outstanding items, explain what the user needs to do before re-invoking.

### Common outstanding reasons and suggested actions

| Reason | Suggested action |
|--------|-----------------|
| Unknown tool name in agent/skill file | Remove or correct the tool name in the .agent.md / SKILL.md |
| Missing npm package | Run `npm install <package>` in the frontend directory |
| Missing pip package | Add package to `requirements.txt` and run `pip install -r requirements.txt` |
| Pylance can't find module (not installed) | Activate the venv and `pip install <package>` |
| TypeScript strict null error requiring design change | Use `/plan` to design the fix |
| Unreachable generated file | Regenerate with the appropriate tool or ignore pattern |
