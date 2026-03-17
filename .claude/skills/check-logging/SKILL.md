---
name: check-logging
description: 'Grep-based logging coverage checker. Detects silent exception swallowing, missing module-level loggers, and route handlers with no log calls — fast, no file-reading loop.'
argument-hint: 'Optional: "fix" to auto-fix any violations found'
---

# Skill: Check Logging

Enforce Carameli's logging conventions using targeted grep passes.
No state file. No file-reading loop. Runs in seconds.

---

## The Three Checks

| # | Name | Rule |
|---|---|---|
| 1 | **Silent except** | Every `except` block in `app/` that catches `Exception` must call `logger.error` or `logger.warning` |
| 2 | **Missing module logger** | Every `.py` file in `app/` must declare `logger = logging.getLogger(__name__)` at module scope |
| 3 | **Silent route handler** | Every route handler file in `app/api/` must contain at least one `logger.` call |

---

## Step 1 — Run the Checks

Run all three checks in parallel. For each, collect every match as a violation.

### Check 1 — Silent except blocks

Two-step: find files with bare `except Exception` blocks, then confirm they contain no `logger.` call in the same file.

```bash
# Step A: files that catch Exception
grep -rln \
  --include="*.py" \
  -E "except Exception" \
  app/
```

```bash
# Step B: from Step A results, find which files have NO logger call at all
grep -rLn \
  --include="*.py" \
  "logger\." \
  app/
```

Files appearing in Step A but NOT in Step B are violations — they catch Exception but never log.

> Note: A file that has *some* logger calls may still silently swallow specific except blocks.
> Flag any file where `except Exception` count > `logger.error\|logger.warning` count as a
> potential gap and note it in the report without blocking on it.

### Check 2 — Missing module-level logger

```bash
# Files in app/ that never declare a module logger
grep -rL \
  --include="*.py" \
  "logger = logging.getLogger" \
  app/
```

Exclude `__init__.py` files and `app/core/logging_config.py` (which defines the logger setup, not a user).

### Check 3 — Route handlers with no logging

```bash
# Files in app/api/ with no logger calls at all
grep -rL \
  --include="*.py" \
  "logger\." \
  app/api/
```

Every route file should log at minimum one INFO entry per handler.

---

## Step 2 — Report

Print results in this format:

```
## Logging Check — YYYY-MM-DD

### Check 1: Silent except blocks
  PASS   All exception handlers log before returning.

  — or —

  VIOLATION  app/services/call_sync.py   catches Exception with no logger call

### Check 2: Missing module logger
  PASS   All app/ modules declare a logger.

  — or —

  VIOLATION  app/services/new_service.py   no `logger = logging.getLogger(__name__)`

### Check 3: Silent route handlers
  PASS   All route files contain at least one logger call.

  — or —

  VIOLATION  app/api/vsapi/area_codes.py   no logger calls found

---
Summary: X violation(s) across Y check(s).
```

If all checks pass, print:
```
All logging checks passed. No violations found.
```

---

## Step 3 — Fix (only if "fix" argument was passed)

For each violation, apply the minimal correct fix:

### Silent except fix
- Add `logger.error("...: %s", exc, exc_info=exc)` inside the except block.
- Use `logger.warning` for expected/recoverable errors, `logger.error` for unexpected ones.
- Do not restructure the surrounding try/except.

### Missing module logger fix
- Add these two lines near the top of the file, after imports:
  ```python
  import logging
  logger = logging.getLogger(__name__)
  ```
- If `import logging` already exists, add only the `logger =` line.

### Silent route handler fix
- Add `logger.info(...)` at the start of each route handler function body.
- Follow the convention: log the operation and key identifier (e.g. customer ID, phone number).
- Example: `logger.info("GET phone line %s", line_id)`
- Never log secret values (`api_key`, passwords, tokens).

After fixing, re-run all three grep checks (Step 1) to confirm clean.
Report a before/after summary of files changed.

---

## Hard Rules

1. This skill only touches files with confirmed violations — never pre-emptive refactors.
2. In report-only mode (no "fix" argument), never modify any file.
3. Do not chase secondary issues found while reading violation files — report them only.
4. One violation = one minimal fix. Do not restructure surrounding code.
5. Never log values that could contain secrets: `api_key`, `password`, `token`, `secret`.
