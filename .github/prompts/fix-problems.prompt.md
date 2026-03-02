# Fix problems

---
agent: agent
tools: [problems, runTask]
description: Run the lint task, then fix any problems that remain.
---

## Workflow

Repeat until `#problems` is empty:

1. Run the VS Code task **"Lint: Everything"** (defined in `.vscode/tasks.json`) and wait for it to finish.
2. Check `#problems` for remaining diagnostics.
3. If there are none, stop.
4. Otherwise, fix only the issues that the linter could not auto-fix — make the **smallest safe changes** needed.
5. Go back to step 1.

## Rules

- Do **not** run any linting commands directly (no `ruff`, `eslint`, `tsc`, etc.). The only linting is done via the **"Lint: Everything"** task.
- Do not refactor unrelated code.
- Do not make changes beyond what is required to clear the remaining diagnostics.
