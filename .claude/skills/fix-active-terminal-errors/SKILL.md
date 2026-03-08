---
name: fix-active-terminal-errors
description: 'Fix errors shown in active terminal/task outputs, then rerun "Lint: Everything" to catch any additional issues and continue fixing.'
argument-hint: 'Optional focus (e.g., "python only", "markdown only", "active lint tasks")'
---

# Fix Active Terminal Errors (+ Lint Everything Re-check)

## What this skill does
Resolves issues reported by active terminal/task output (especially lint task output), then reruns `Lint: Everything` to surface additional errors and continue targeted fixes.

## When to use
- User asks to "fix what the terminal already shows".
- User wants a verification pass after fixes to catch newly revealed issues.
- CI/lint output is available from active tasks and only targeted fixes are needed.

## Procedure
1. **Collect active output only**
   - Read output from active tasks/terminals.
   - Prefer task output for named tasks (e.g., `Lint: Python`, `Lint: Markdown`).
   - Start from currently visible output before any rerun.

2. **Extract actionable errors**
   - Build a short list of file/line/rule entries from output.
   - If output is truncated, fix all visible items first.

3. **Apply minimal edits**
   - Edit only implicated files.
   - Keep changes narrow and style-preserving.
   - Avoid broad refactors and unrelated cleanup.

4. **Validate local edits first**
   - Use editor diagnostics/problems for changed files only.

5. **Run full lint re-check**
   - Run task `Lint: Everything` once after fixes are applied.
   - Capture any newly surfaced errors that were hidden by earlier failures.

6. **Fix newly surfaced issues**
   - Apply minimal edits for new errors from the rerun.
   - Repeat fix → rerun `Lint: Everything` until clean, or until output is truncated/blocked.

7. **Report clearly**
   - Summarize fixed items.
   - Call out any unresolved items blocked by truncated/missing task output.
   - Include the final `Lint: Everything` status.

## Decision points
- **Terminal ID invalid / unavailable**: fall back to task output and Problems panel diagnostics.
- **Output truncated**: fix all visible violations, then mark remaining as unknown/unverified.
- **Rerun task unavailable**: use closest available lint tasks and clearly report substitution.
- **Mixed error classes (e.g., Python + Markdown)**: batch by file type for minimal, auditable edits.

## Completion checklist
- Only errors present in active output were targeted.
- `Lint: Everything` was rerun after fixes.
- Newly surfaced errors from rerun were fixed or explicitly listed.
- Changed files have no editor diagnostics (or are clearly marked blocked).
- Response includes fixed files and any remaining uncertainty.
