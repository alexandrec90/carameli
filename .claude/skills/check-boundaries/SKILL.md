---
name: check-boundaries
disable-model-invocation: true
description: 'Grep-based checker for provider leaks, layer violations, and blocking I/O in async handlers. Use when reviewing code changes or running a pre-commit structural audit.'
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

Run the suggested harness command. Output should be grouped by check; each
match is `path:line:content`.

Run three Grep passes directly:

- **Check 1 — Provider boundary:** grep `^\s*(import telnyx|from telnyx|import jambonz|from jambonz)` across `app/**/*.py`, excluding files under `app/services/providers/`
- **Check 2 — Layer boundary:** grep `from app\.repositories\.` across `app/api/**/*.py`
- **Check 3 — Blocking I/O:** grep `^\s*(import requests|from requests|import urllib\.request|import time$|from time import sleep|import subprocess|from subprocess)` across `app/**/*.py`

### Interpretation

- **Check 1 — Provider boundary leak.** A match means production code is
  bypassing the `CarrierProvider` / `CallEngineProvider` abstraction and
  calling the SDK directly.
- **Check 2 — Layer boundary violation.** Route handlers must call services,
  not repositories. Services call repositories.
- **Check 3 — Blocking I/O in async modules.** Any match is a potential
  event-loop block. Async code must use `httpx.AsyncClient`, `asyncio.sleep`,
  or `asyncio.create_subprocess_*`.

---

## Step 2 — Report

Print results in this format:

```text
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

```text
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

After fixing, report a before/after summary of files changed and tell the user
to re-invoke `/check-boundaries` to re-verify (using the same suggested command
from Step 1).

---

## Hard Rules

1. This skill only touches files with confirmed violations — never pre-emptive refactors.
2. In report-only mode (no "fix" argument), never modify any file.
3. Do not chase secondary issues found while reading violation files — report them only.
4. One violation = one minimal fix. Do not restructure surrounding code.
