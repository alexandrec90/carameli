---
name: audit-deps
description: 'Audits requirements.txt and requirements-dev.txt for unused, missing, or misplaced Python dependencies. Use when adding or removing packages, or when imports do not match listed requirements.'
argument-hint: 'No arguments needed — always scans and applies any required updates.'
---

# Skill: Audit Python Dependencies

Scan the codebase imports against `requirements.txt` and `requirements-dev.txt` to
find misplaced, unused, or missing dependencies.

---

## Step 1 — Read Current State

Read all of the following **in parallel**:

| File | What to extract |
| --- | --- |
| `requirements.txt` | Prod dependencies (pinned or lower-bounded) |
| `requirements-dev.txt` | Dev dependencies (includes `-r requirements.txt`) |
| `Dockerfile` | Which requirements file is installed in the image |

---

## Step 2 — Build Import Map

Scan **first-party Python source** for all third-party imports:

1. Grep `app/**/*.py` for `import` and `from ... import` statements.
2. Grep `tests/**/*.py` for the same.
3. Grep `alembic/**/*.py` for the same.

For each import, resolve the PyPI package name (e.g., `import sqlalchemy` maps to
`sqlalchemy`, `from fastapi import ...` maps to `fastapi`, `import asyncpg` maps to
`asyncpg`). Use common mapping knowledge for packages where the import name differs
from the PyPI name:

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

For each requirement in both files, classify it:

| Classification | Rule |
| --- | --- |
| **Used in prod** | Imported by files under `app/` or `alembic/` |
| **Used in dev only** | Imported only by files under `tests/` or dev tooling |
| **Unused** | Not imported anywhere |
| **Transitive** | Not imported directly but is a known dependency of another package (e.g., `asyncpg` is required by `sqlalchemy[asyncio]`) |

Also check for:

- **Missing from requirements**: imported in source but not listed in either file.
- **Misplaced**: listed in `requirements.txt` (prod) but only used in tests/dev.
- **Misplaced**: listed in `requirements-dev.txt` but imported in `app/` (should be in prod).

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
| locust | requirements-dev.txt | Correct | No change |
| hypothesis | requirements.txt | Dev-only (tests/) | Move to requirements-dev.txt |
| pyjwt | (missing) | Imported in app/core/auth.py | Add to requirements.txt |
| some-unused-lib | requirements.txt | Not imported anywhere | Remove |
```

---

## Step 5 — Apply Updates

For each issue:

- **Misplaced prod→dev**: Remove from `requirements.txt`, add to `requirements-dev.txt`
  (after the `-r requirements.txt` line).
- **Misplaced dev→prod**: Remove from `requirements-dev.txt`, add to `requirements.txt`.
- **Missing**: Add to the appropriate file with a `>=` lower bound matching the
  currently installed version (check with `pip show <package>` if available, otherwise
  use a reasonable recent version).
- **Unused**: Remove the line. If uncertain (could be a transitive dep), note it in
  the report but do not remove.

Preserve existing version specifiers, comments, and sort order.

---

## Step 6 — Verify

Print a final summary of changes made and any packages flagged as uncertain.

## Checklist

- [ ] `requirements.txt` and `requirements-dev.txt` read
- [ ] All `app/`, `tests/`, and `alembic/` imports scanned
- [ ] Each dependency classified (prod / dev / unused / transitive / missing)
- [ ] Misplaced dependencies moved to correct file
- [ ] Missing dependencies added
- [ ] Unused dependencies removed (or flagged if uncertain)
- [ ] Final summary printed
