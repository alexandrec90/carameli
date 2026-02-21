````prompt
---
agent: agent
tools: [problems, read/readFile]
description: Fix all issues surfaced in #problems and verify they are resolved.
---

# Fix `#problems`

Use `#problems` as the source of truth and fix every active diagnostic.

## Scope

- Prioritize **errors** first, then warnings.
- Make the **smallest safe changes** needed.
- Do not refactor unrelated code.

## Required workflow

1. Read all diagnostics from `#problems`.
2. Group by file and fix in small, testable commits.
3. After each file change, re-check diagnostics.
4. Run relevant validation:
   - Python changes: `ruff check .` and `docker compose exec app pytest`
   - Frontend changes: `npm --prefix frontend run lint:types` and `npm --prefix frontend run lint:eslint`
5. Continue until `#problems` is clean (or only intentionally deferred warnings remain).

## Project rules to enforce while fixing

- Follow `.claude/rules/python-style.md` for FastAPI, typing, and async patterns.
- Follow `.claude/rules/logging.md` for logger usage (`%s` formatting, no secrets).
- Follow `.claude/rules/database.md` for SQLAlchemy/Alembic conventions.
- Follow `.claude/rules/twilio.md` for Twilio client/error handling patterns.
- Follow `.claude/rules/ui-design.md` for frontend visual/style changes.

## Done criteria

- No remaining actionable diagnostics in `#problems`.
- Lint/tests for touched areas pass.
- Summarize:
  - Files changed
  - Root cause per issue
  - Validation performed
  - Any follow-up items
````