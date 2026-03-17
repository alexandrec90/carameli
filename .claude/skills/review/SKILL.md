---
name: review
description: 'Run all structural invariant checks (boundaries, secrets, migrations, logging) and fix any violations found.'
argument-hint: 'No arguments — always checks and fixes.'
---

# Skill: Review

Two-phase: one cheap Explore agent detects all violations across all checks, then fix agents
spawn **only for checks that had violations** — sequentially to avoid write conflicts.

---

## Phase 1 — Detect (always runs)

Spawn one **Explore** agent with this prompt:

> You are running detection-only passes for four structural checks on the Carameli project at
> `c:\Users\Administrator\Desktop\vs_code\carameli`. **Do NOT modify any files.**
>
> Use the Grep tool for grep checks and Bash for docker commands. Run all checks.
>
> ---
>
> ### BOUNDARIES (3 checks)
>
> **B1 — Provider boundary leak**
> Grep `app/` (`*.py`) for: `^\s*(import telnyx|from telnyx|import jambonz|from jambonz)`
> Exclude any match whose path contains `app/services/providers/`.
>
> **B2 — Layer boundary violation**
> Grep `app/api/` (`*.py`) for: `from app\.repositories\.`
>
> **B3 — Sync-in-async**
> Grep `app/` (`*.py`) for:
> `^\s*(import requests|from requests|import urllib\.request|import time$|from time import sleep|import subprocess|from subprocess)`
>
> ---
>
> ### SECRETS (2 checks)
>
> **S1 — Credential fields in response schemas**
> Grep `app/schemas/` (`*.py`) for: `^\s+(api_key|password|secret|token)\s*:`
>
> **S2 — Raw env var access for credentials**
> Grep `app/` (`*.py`) for: `os\.(environ\.get|getenv)\(["'](.*key.*|.*secret.*|.*password.*|.*token.*)`
> Exclude `app/core/config.py`.
>
> ---
>
> ### MIGRATIONS (3 checks)
>
> **M1 — Linear history**
> Run: `docker compose -f c:\Users\Administrator\Desktop\vs_code\carameli\docker-compose.yml exec app alembic history --verbose 2>&1`
> Flag any line containing `(branchpoint)` or `(mergepoint)`.
>
> **M2 — Downgrade completeness**
> Grep `alembic/versions/` (`*.py`) for `def downgrade`. For each matched file, check whether
> the function body is only `pass` or a comment — flag those as WARNING.
>
> **M3 — Model drift**
> Run: `docker compose -f c:\Users\Administrator\Desktop\vs_code\carameli\docker-compose.yml exec app alembic check 2>&1`
> Non-zero exit = VIOLATION.
>
> ---
>
> ### LOGGING (3 checks)
>
> **L1 — Silent except blocks**
> Step A: grep `app/` (`*.py`) for files containing `except Exception` (files-with-matches).
> Step B: from that set, find which have NO `logger\.` call anywhere.
> Violations = files present in Step A but absent from Step B.
>
> **L2 — Missing module logger**
> Grep `app/` (`*.py`) for files NOT containing `logger = logging.getLogger`.
> Exclude `__init__.py` and `app/core/logging_config.py`.
>
> **L3 — Silent route handlers**
> Grep `app/api/` (`*.py`) for files NOT containing `logger\.`
>
> ---
>
> Return results in this exact compact format — one line per violation, PASS if clean:
>
> ```
> BOUNDARIES
> B1: PASS  — or —  VIOLATION  file:line  matched text
> B2: PASS  — or —  VIOLATION  file:line  matched text
> B3: PASS  — or —  VIOLATION  file:line  matched text
>
> SECRETS
> S1: PASS  — or —  VIOLATION  file:line  matched text
> S2: PASS  — or —  VIOLATION  file:line  matched text
>
> MIGRATIONS
> M1: PASS  — or —  VIOLATION  description
> M2: PASS  — or —  WARNING  file  description
> M3: PASS  — or —  VIOLATION  description
>
> LOGGING
> L1: PASS  — or —  VIOLATION  file  description
> L2: PASS  — or —  VIOLATION  file
> L3: PASS  — or —  VIOLATION  file
> ```
>
> No prose — just the structured result block.

---

## Phase 2 — Fix (conditional)

After Phase 1 returns, inspect the result:

- If **all checks passed**: skip Phase 2 entirely, go straight to Step 3.
- For each check group with at least one violation, spawn a fix agent **one at a time**
  (sequential — never parallel — to avoid write conflicts across shared files).

Spawn in this order if the group has violations:

### Fix agent: Boundaries
> You are fixing boundary violations in the Carameli project at
> `c:\Users\Administrator\Desktop\vs_code\carameli`.
>
> Violations identified:
> [insert the BOUNDARIES lines from Phase 1 here]
>
> Read `.claude/skills/check-boundaries/SKILL.md` and execute its Step 3 (Fix)
> for each violation listed above. Re-run its Step 1 greps after fixing to confirm clean.
> Return: list of files changed and whether verification passed.

### Fix agent: Secrets
> You are fixing secret hygiene violations in the Carameli project at
> `c:\Users\Administrator\Desktop\vs_code\carameli`.
>
> Violations identified:
> [insert the SECRETS lines from Phase 1 here]
>
> Read `.claude/skills/lint-secrets/SKILL.md` and execute its Step 3 (Fix)
> for each violation listed above. Re-run its Step 1 greps after fixing to confirm clean.
> Return: list of files changed and whether verification passed.

### Fix agent: Migrations
> You are fixing migration violations in the Carameli project at
> `c:\Users\Administrator\Desktop\vs_code\carameli`.
>
> Violations identified:
> [insert the MIGRATIONS lines from Phase 1 here]
>
> Read `.claude/skills/check-migrations/SKILL.md` and execute its Step 3 (Fix).
> Important: branch points (M1) and model drift (M3) must NOT be auto-fixed — report
> them as requiring manual action. Only downgrade bodies (M2) can be fixed here.
> Re-run M2 grep after fixing to confirm clean.
> Return: list of files changed and whether verification passed.

### Fix agent: Logging
> You are fixing logging violations in the Carameli project at
> `c:\Users\Administrator\Desktop\vs_code\carameli`.
>
> Violations identified:
> [insert the LOGGING lines from Phase 1 here]
>
> Read `.claude/skills/check-logging/SKILL.md` and execute its Step 3 (Fix)
> for each violation listed above. Re-run its Step 1 greps after fixing to confirm clean.
> Return: list of files changed and whether verification passed.

---

## Step 3 — Print Summary

```
# Code Review — YYYY-MM-DD

| Check      | Result   | Violations | Files Changed |
|------------|----------|------------|---------------|
| Boundaries | PASS/FIXED/ERROR | X | Y |
| Secrets    | PASS/FIXED/ERROR | X | Y |
| Migrations | PASS/FIXED/ERROR | X | Y |
| Logging    | PASS/FIXED/ERROR | X | Y |
```

Result values: `PASS` (no violations), `FIXED` (violations found and resolved),
`MANUAL` (violations require human action), `ERROR — <reason>` (agent failed).

If every check was PASS: print instead:
```
All checks passed — no violations, no migration drift, no secret leaks.
```

---

## Hard Rules

1. The Phase 1 Explore agent must never modify any file.
2. Fix agents run strictly sequentially — never in parallel.
3. Only spawn a fix agent for a check group that has violations — skip clean groups entirely.
4. If a fix agent errors, mark that check `ERROR — <reason>` in the summary and continue to the next.
5. Never retry a fix agent — one pass per check.
6. Migration branch points and model drift: report as `MANUAL`, never auto-fix.
