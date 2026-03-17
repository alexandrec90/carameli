---
name: check-boundaries
description: 'Grep-based structural invariant checker. Detects provider leaks, layer violations, and blocking I/O in async handlers — fast, no file-reading loop.'
argument-hint: 'Optional: "fix" to auto-fix any violations found'
---

# Skill: Check Boundaries

Enforce Carameli's three structural invariants using targeted grep passes.
No state file. No file-reading loop. Runs in seconds.

---

## The Three Invariants

| # | Name | Rule |
|---|---|---|
| 1 | **Provider boundary** | `telnyx` and `jambonz` SDK symbols may only be imported inside `app/services/providers/` |
| 2 | **Layer boundary** | `app/api/` must not import from `app/repositories/` directly — all DB access must go through `app/services/` |
| 3 | **Sync-in-async** | Blocking I/O (`requests`, `urllib`, `time.sleep`, `subprocess`) must not be imported in any `app/` module |

---

## Step 1 — Run the Checks

Run all three checks in parallel. For each, collect every match as a violation.

### Check 1 — Provider boundary leak

```bash
# Find any import of telnyx or jambonz outside of app/services/providers/
grep -rn \
  --include="*.py" \
  -E "^\s*(import telnyx|from telnyx|import jambonz|from jambonz)" \
  app/ \
  | grep -v "app/services/providers/"
```

A match here means production code is bypassing the `CarrierProvider` /
`CallEngineProvider` abstraction and calling the SDK directly.

### Check 2 — Layer boundary violation

```bash
# Find any route handler or webhook importing a repository directly
grep -rn \
  --include="*.py" \
  -E "from app\.repositories\." \
  app/api/
```

Route handlers must call services, not repositories. Services call repositories.

### Check 3 — Blocking I/O in async modules

```bash
# Find blocking-I/O imports anywhere in app/ (these stall the event loop)
grep -rn \
  --include="*.py" \
  -E "^\s*(import requests|from requests|import urllib\.request|import time$|from time import sleep|import subprocess|from subprocess)" \
  app/
```

Any match is a potential event-loop block. Async code must use `httpx.AsyncClient`,
`asyncio.sleep`, or `asyncio.create_subprocess_*`.

---

## Step 2 — Report

Print results in this format:

```
## Boundary Check — YYYY-MM-DD

### Check 1: Provider boundary
  PASS   No SDK leaks found.

  — or —

  VIOLATION  app/api/vsapi/sms.py:12   import telnyx
  VIOLATION  app/services/call_sync.py:5  from jambonz import client

### Check 2: Layer boundary
  PASS   No direct repository imports in app/api/.

  — or —

  VIOLATION  app/api/vsapi/phone_lines.py:8   from app.repositories.phone_line_repo import PhoneLineRepo

### Check 3: Sync-in-async
  PASS   No blocking I/O imports found.

  — or —

  VIOLATION  app/services/call_sync.py:3   import requests

---
Summary: X violation(s) across Y check(s).
```

If all three checks pass, print:
```
All boundary checks passed. No violations found.
```

---

## Step 3 — Fix (only if "fix" argument was passed)

For each violation, apply the minimal correct fix:

### Provider leak fix
- Remove the direct SDK import.
- Replace usage with the injected provider instance (already available via
  `app/services/providers/factory.py`).
- If the file is a service module (not a provider), inject the provider via
  function argument following the pattern in `app/services/call_control.py`.

### Layer bypass fix
- Move the repository call into an existing or new method in
  `app/services/<domain>_service.py`.
- Update the route handler to call the service method instead.
- Do not change the route's public contract (method, path, response schema).

### Blocking I/O fix
- Replace `import requests` with `import httpx` and use `httpx.AsyncClient`.
- Replace `time.sleep(n)` with `await asyncio.sleep(n)`.
- Replace `subprocess.run(...)` with `await asyncio.create_subprocess_exec(...)`.

After fixing, re-run all three grep checks (Step 1) to confirm clean.
Report a before/after summary of files changed.

---

## Hard Rules

1. This skill only touches files with confirmed violations — never pre-emptive refactors.
2. In report-only mode (no "fix" argument), never modify any file.
3. Do not chase secondary issues found while reading violation files — report them only.
4. One violation = one minimal fix. Do not restructure surrounding code.
