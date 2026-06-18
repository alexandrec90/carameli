---
name: refactor
disable-model-invocation: true
description: 'Refactors first-party source files using a state.json tracking workflow. Use when improving code quality, reducing complexity, or applying consistent style fixes across a set of files.'
argument-hint: 'Optional focus path or file (e.g., "frontend/src/pages")'
---

# Skill: Refactor Codebase

Clean up and reorganize first-party source files. Skip libraries, generated
files, and files unchanged since their last refactor pass.

---

## Step 1 — Load State

Read `.claude/skills/refactor/state.json`. It maps file paths to
`{ refactored_at, git_hash }` where `git_hash` is the SHA of the last commit
touching that file at the time it was refactored.

---

## Step 2 — Discover Source Files

Run the discovery command below to gather the top 50 source files by line count, each with its last-commit git hash. TSV columns: `lines<TAB>hash<TAB>path`.

Suggested command (run in terminal):
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/discover-files.ps1 -Roots app,frontend/src -Includes *.py,*.ts,*.tsx -ExcludeDirs node_modules,.git,venv,.venv,dist,build,__pycache__,alembic/versions,tests,__tests__,.claude,coverage,logs,.pytest_cache -ExcludeNames *.d.ts,*.config.ts,*.config.js,*.config.mjs,conftest.py,*.test.ts,*.spec.ts,test_*.py,*_test.py -Top 50 -WithGitHash
```

---

## Step 3 — Triage

The git hashes from Step 2 are pre-computed. Triage each path against `state.json`:

| Status | Condition | Action |
| --- | --- | --- |
| **SKIP** | In state.json and hash matches | Skip |
| **CHANGED** | In state.json but hash differs | Re-evaluate |
| **NEW** | Not in state.json | Full pass |

Sort CHANGED + NEW by priority: largest files first, then files with obviously
mixed concerns.

Output a work list (file, lines, status) before proceeding.

---

## Step 4 — Refactor Each File

One file at a time:

**4a. Read and diagnose.** Look for: files too large to reason about as a unit
(> 300 lines Python / > 250 lines TS), mixed concerns that belong in separate
modules, duplication worth extracting, dead code to delete.

**4b. Plan.** For splits, name the new file(s) explicitly before touching
anything. For in-place cleanup, a one-line description suffices.

**4c. Edit.**

- `Edit` for in-place changes; `Write` only for new files from a split.
- When splitting, update every import site that referenced moved symbols.
- Do not change public interfaces, add comments, or reformat untouched code.

**4d. Verify — splits only.** If new files were created:

```bash
# Python
docker compose exec app python -m py_compile <new_file>

# TypeScript
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Fix any import error before moving on.

---

## Step 5 — Update State

Write `.claude/skills/refactor/state-updates.json` with touched files:

```json
{
  "files": {
    "frontend/src/pages/DashboardPage.tsx": {
      "git_hash": "<sha-or-UNCOMMITTED>",
      "refactored_at": "YYYY-MM-DD"
    }
  }
}
```

The skill's `Stop` hook detects `state-updates.json`, runs `state-engine.py
apply`, and removes the file. Do not run `apply` by hand.

Use `"UNCOMMITTED"` for files edited this session but not yet committed. They
will re-evaluate on the next run once committed.

---

## Step 6 — Report

Summarize: file, action taken (split / cleaned / skipped), lines before → after,
new files created. List any follow-up observations that are out of scope for
this pass.

---

## Hard Rules

1. Never touch `node_modules/`, `venv/`, `alembic/versions/`, test files,
   or `.claude/` itself.
2. Never change public interfaces — this is a structural pass, not an API redesign.
3. One file at a time; complete all sub-steps before starting the next.
4. State file is the source of truth for what has already been handled.
