---
name: refactor
description: 'Refactor first-party source files using the state.json workflow.'
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

Run once to get a line-count overview, sorted largest first:

```bash
find . \
  -not \( \
    -path "*/node_modules/*" -o -path "*/.git/*" -o -path "*/venv/*" \
    -o -path "*/.venv/*" -o -path "*/dist/*" -o -path "*/build/*" \
    -o -path "*/__pycache__/*" -o -path "*/alembic/versions/*" \
    -o -path "*/tests/*" -o -path "*/__tests__/*" -o -path "*/.claude/*" \
    -o -path "*/coverage/*" -o -path "*/logs/*" -o -path "*/.pytest_cache/*" \
  \) \
  \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" \) \
  -not \( \
    -name "*.d.ts" -o -name "*.config.ts" -o -name "*.config.js" \
    -o -name "*.config.mjs" -o -name "conftest.py" \
    -o -name "*.test.ts" -o -name "*.spec.ts" \
    -o -name "test_*.py" -o -name "*_test.py" \
  \) \
  -exec wc -l {} + | sort -rn | head -50
```

---

## Step 3 — Triage

For each file, get its current last-commit hash:

```bash
git log --format="%H" -1 -- <filepath>
```

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

After each file, write its entry back to `.claude/skills/refactor/state.json`:

```bash
git log --format="%H" -1 -- <filepath>
```

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
