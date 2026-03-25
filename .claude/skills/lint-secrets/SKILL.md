---
name: lint-secrets
description: 'Grep-based credential hygiene checker. Detects credential fields in response schemas and raw env-var bypass of pydantic-settings. Use when reviewing new endpoints or schemas for accidental secret exposure.'
argument-hint: 'Optional: "fix" to auto-fix any violations found'
---

# Skill: Lint Secrets

Enforce Carameli's credential hygiene rules using targeted grep passes.
No state file. No file-reading loop. Runs in seconds.

> **Note:** Generic secret detection (hardcoded keys, secrets in log calls) is
> handled by `detect-secrets` in `.pre-commit-config.yaml` — no tokens needed.
> This skill covers the two Carameli-architecture-specific rules that no generic
> linter knows about.

---

## The Two Checks

| # | Name | Rule |
|---|---|---|
| 1 | **Credential fields in responses** | Pydantic response schemas must not expose `api_key`, `password`, `secret`, or `token` fields |
| 2 | **Env var bypass** | Credentials must come from `settings.*` (pydantic-settings) — never from `os.environ.get` or `os.getenv` directly in business logic |

---

## Step 1 — Run the Checks

Run both checks in parallel. Collect every match as a violation.

### Check 1 — Credential fields in response schemas

```bash
# Response schemas (classes ending in Response or Out) exposing raw secret fields
grep -rn \
  --include="*.py" \
  -E "^\s+(api_key|password|secret|token)\s*:" \
  app/schemas/
```

Request schemas may accept these fields (for create/auth routes). Only *response* schemas
are checked — detect by class name ending in `Response`, `Out`, or `Read`.

### Check 2 — Raw env var access for credentials

```bash
# os.environ / os.getenv calls for credential-named variables outside app/core/config.py
grep -rn \
  --include="*.py" \
  -E 'os\.(environ\.get|getenv)\(["\x27](.*key.*|.*secret.*|.*password.*|.*token.*)["\x27]' \
  app/ \
  | grep -v "app/core/config.py"
```

---

## Step 2 — Report

```text
## Secret Hygiene Check — YYYY-MM-DD

### Check 1: Credential fields in response schemas
  PASS   No secret fields in response schemas.

  — or —

  VIOLATION  app/schemas/customer.py:34   api_key: str  (in CustomerResponse)

### Check 2: Raw env var access
  PASS   All credentials sourced through settings.

  — or —

  VIOLATION  app/services/call_sync.py:8
             os.getenv("TELNYX_API_KEY")

---
Summary: X violation(s) across Y check(s).
```

If all checks pass, print:

```text
All secret hygiene checks passed. No violations found.
```

---

## Step 3 — Fix (only if "fix" argument was passed)

### Response schema leak fix

- Remove the credential field from the response schema.
- If the field is legitimately needed (e.g. initial API key display on create), add a
  `write_only: ClassVar = True` comment and gate it behind a dedicated one-time endpoint.

### Env var bypass fix

- Move the `os.getenv(...)` call into `app/core/config.py` as a settings field.
- Replace the call site with `settings.<field_name>`.

After fixing, re-run both checks (Step 1) to confirm clean.

---

## Hard Rules

1. This skill only touches files with confirmed violations — never pre-emptive changes.
2. In report-only mode (no "fix" argument), never modify any file.
3. Do not chase secondary issues found while reading violation files — report them only.
