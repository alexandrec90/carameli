---
name: audit-deps
disable-model-invocation: true
description: 'Audits the requirements floor files (.in) for unused, missing, or misplaced Python dependencies. Use when adding or removing packages, or when imports do not match listed requirements.'
argument-hint: 'No arguments needed — always scans and applies any required updates.'
---

# Skill: Audit Python Dependencies

Scan the codebase imports against the three human-edited floor files to find
misplaced, unused, or missing dependencies. The `requirements*.txt` files are
compiled locks — **never hand-edit them**; every fix lands in a `.in` file
followed by a lock recompile (see CLAUDE.md → Guardrails → Dependencies).

---

## Step 1 — Read Current State

Read all of the following **in parallel**:

| File | What to extract |
| --- | --- |
| `requirements.in` | Runtime floors (installed everywhere, incl. prod image) |
| `requirements-test.in` | In-container test toolchain floors (includes `-r requirements.in`) |
| `requirements-dev.in` | Host-only tooling floors (includes `-r requirements-test.in`) |
| `Dockerfile` | Which lock each image stage installs (`runtime` → requirements.txt, `dev` → requirements-test.txt) |

---

## Step 2 — Build Import Map

Scan **first-party Python source** for all third-party imports:

1. Grep `app/**/*.py` for `import` and `from ... import` statements.
2. Grep `tests/**/*.py` for the same — note which are under the
   container-excluded dirs (`tests/e2e/`, `tests/load/`, `tests/quarantine/`;
   see `pytest.ini` addopts) since those run on the host only.
3. Grep `alembic/**/*.py` and `scripts/**/*.py` for the same.

For each import, resolve the PyPI package name (e.g., `import sqlalchemy` maps to
`sqlalchemy`, `from fastapi import ...` maps to `fastapi`). Use common mapping
knowledge for packages where the import name differs from the PyPI name:

| Import | PyPI package |
| --- | --- |
| `PIL` | `pillow` |
| `cv2` | `opencv-python` |
| `yaml` | `pyyaml` |
| `jose` | `python-jose` |
| `dotenv` | `python-dotenv` |
| `multipart` | `python-multipart` |
| `gi` | `pygobject` |

---

## Step 3 — Classify Each Dependency

For each floor in the three `.in` files, classify it:

| Classification | Rule |
| --- | --- |
| **Runtime** | Imported by files under `app/` or `alembic/` → `requirements.in` |
| **Container test** | Imported by container-run tests (`tests/` minus e2e/load/quarantine) or required by `pytest.ini` options → `requirements-test.in` |
| **Host tooling** | Only used by host-run tests (e2e/load), lint/type tools, or `scripts/` → `requirements-dev.in` |
| **Unused** | Not imported anywhere |
| **Transitive** | Not imported directly but is a known dependency of another package (e.g., `asyncpg` via `sqlalchemy[asyncio]`) |

Also check for:

- **Missing from requirements**: imported in source but not listed in any floor file.
- **Misplaced**: listed in a floor file whose scope doesn't match where it's imported
  (e.g. a package in `requirements-dev.in` that container tests import belongs in
  `requirements-test.in`; anything imported from `app/` belongs in `requirements.in`).

---

## Step 4 — Report

If everything is correct, print:

```text
All dependencies are correctly placed — no changes needed.
```

and stop.

Otherwise, print:

```text
## Dependency Audit

| Package | Current File | Issue | Recommendation |
|---|---|---|---|
| locust | requirements-dev.in | Correct | No change |
| hypothesis | requirements-dev.in | Container tests import it | Move to requirements-test.in |
| pyjwt | (missing) | Imported in app/core/auth.py | Add to requirements.in |
| some-unused-lib | requirements.in | Not imported anywhere | Remove |
```

---

## Step 5 — Apply Updates

All edits target the `.in` floor files only:

- **Misplaced**: Move the floor line to the correct `.in` file (keep its version bound).
- **Missing**: Add to the appropriate `.in` file with a `>=` lower bound matching the
  currently installed version (check with `pip show <package>` if available, otherwise
  use a reasonable recent version).
- **Unused**: Remove the line. If uncertain (could be a transitive dep), note it in
  the report but do not remove.

Preserve existing version specifiers, comments, and sort order. Then recompile the
locks in the same change (VS Code task "Deps: Recompile Python Lockfiles").

---

## Step 6 — Verify

Print a final summary of changes made and any packages flagged as uncertain.

## Checklist

- [ ] All three `.in` floor files read
- [ ] All `app/`, `tests/`, `alembic/`, and `scripts/` imports scanned
- [ ] Each dependency classified (runtime / container-test / host-tooling / unused / transitive / missing)
- [ ] Misplaced floors moved to the correct `.in` file
- [ ] Missing floors added, unused removed (or flagged if uncertain)
- [ ] Locks recompiled (never hand-edited)
- [ ] Final summary printed
