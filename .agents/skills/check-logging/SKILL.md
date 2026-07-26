---
name: check-logging
disable-model-invocation: true
description: 'Grep-based logging coverage checker. Detects silent exception swallowing, missing module-level loggers, and route handlers with no log calls. Use when auditing logging coverage or reviewing new code.'
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
| 4 | **Silent frontend catch** | Frontend `catch {}` / `.catch(() => {})` handlers must not swallow errors silently |

---

## Step 1 — Run the Checks

Run the suggested harness command. Output should be grouped by check label.

Run four Grep passes directly:

- **Check 1 — Silent except:** grep `except Exception` across `app/**/*.py` (files_with_matches). Then grep `logger\.` across the same set. Any file in the first set but absent from the second is a `VIOLATION`. Any file where the count of `except Exception` lines exceeds the count of `logger\.(error|warning)` lines is a `POTENTIAL`.
- **Check 2 — Missing logger:** grep `logger = logging\.getLogger` across `app/**/*.py` (files_with_matches). Any `.py` file in `app/` that is not `__init__.py` or `app/core/logging_config.py` and does not appear in that set is a `VIOLATION`.
- **Check 3 — Silent route handlers:** grep `logger\.` across `app/api/**/*.py` (files_with_matches). Any non-`__init__.py` file in `app/api/` absent from that set is a `VIOLATION`.
- **Check 4 — Silent frontend catch:** grep `catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(\(\)|_)\s*=>\s*\{?\s*\}?\s*\)` across `frontend/src/**/*.{ts,tsx}` (files_with_matches). For each match, check whether the same file contains `logger\.error\(` — if not, it is a `VIOLATION`.

### Interpretation

- **Check 1 — Silent except blocks.** `VIOLATION` = file catches Exception but
  has no logger call at all. `POTENTIAL` = except-Exception count exceeds
  logger.error/warning count — still has a logger, but may silently swallow
  specific blocks. Flag `POTENTIAL` without blocking on it.
- **Check 2 — Missing module-level logger.** Every `.py` file in `app/`
  (excluding `__init__.py` and `logging_config.py`) must declare
  `logger = logging.getLogger(__name__)`.
- **Check 3 — Silent route handlers.** Every route file in `app/api/` must
  contain at least one `logger.` call.
- **Check 4 — Silent frontend catch handlers.** `catch {}` and `.catch(() => {})`
  in `frontend/src/` are violations unless they log (`logger.error(...)`) or
  explicitly document intentional suppression.

---

## Step 2 — Report

Print results in this format:

```text
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

```text
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

After fixing, report a before/after summary of files changed and tell the user
to re-invoke `/check-logging` to re-verify (using the same suggested command
from Step 1).

---

## Hard Rules

1. This skill only touches files with confirmed violations — never pre-emptive refactors.
2. In report-only mode (no "fix" argument), never modify any file.
3. Do not chase secondary issues found while reading violation files — report them only.
4. One violation = one minimal fix. Do not restructure surrounding code.
5. Never log values that could contain secrets: `api_key`, `password`, `token`, `secret`.
