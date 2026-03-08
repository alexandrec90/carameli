---
name: fix-problems
description: 'Fix issues listed in the Problems panel by polling it once. Use when asked to “just fix #problems”, “problems list only”, and to avoid running tests/lint or re-checking after changes.'
argument-hint: 'Optional scope or file focus (e.g., “only backend”, “only frontend”)'
---

# Fix Problems Only

## What this skill does
Fixes issues already reported in the Problems panel by polling it exactly once, then applying minimal code changes without running tests, lint, or additional diagnostics.

## When to use
- User says “fix #problems”, “just fix the problems”, or similar.
- User explicitly requests **no** tests, **no** linting, and **no** re-checking after changes.

## Procedure
1. **Poll problems once** using the Problems list tool.
2. **If no problems** are reported, tell the user and stop.
3. **For each listed problem**:
   - Open the relevant file and read enough context.
   - Apply the smallest reasonable fix.
4. **Do not** run tests, lint, tasks, or terminal commands unless explicitly requested.
5. **Do not** re-check the Problems list after making edits.

## Decision points
- If a problem is unclear or requires missing context, ask a single clarifying question and stop.
- If the fix would require non-trivial refactors, propose a minimal safe fix first and ask for confirmation.

## Completion checklist
- All originally listed problems addressed (or clearly marked as blocked).
- No extra diagnostics were run beyond the single Problems poll.
- Summary explains what changed and notes that no re-check was performed.
