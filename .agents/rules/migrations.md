---
description: Alembic migration file conventions and safety checks
paths:
  - alembic/versions/**/*.py
---

# Rule: Alembic Migrations

## Naming

- File prefix is a zero-padded sequential number (`001_`, `002_`, ...).
- `revision` and `down_revision` use the bare number string (`"002"`, `"001"`).
- Message (and filename suffix) should be present-tense, descriptive.

## Structure Checklist

Every migration file must have:

1. A module docstring with the human-readable description.
2. `revision`, `down_revision`, `branch_labels`, `depends_on` variables.
3. Both `upgrade()` and `downgrade()` functions — **never leave `downgrade` empty**.
   A migration with no rollback path is a deployment hazard.

## Safety Rules

- **Linear history only** — no branch labels. If `alembic heads` returns more than
  one head, fix it before creating a new migration. (`alembic heads` needs the local
  DB/Docker stack; without it, check for multiple heads by reading the
  `down_revision` values across `alembic/versions/` instead.)
- **Data migrations** (INSERT/UPDATE/DELETE in `op.execute`) must be idempotent or
  guarded, because they may run more than once during development.
- When adding a NOT NULL column to an existing table, use a two-step pattern:
  1. Add the column as nullable.
  2. Backfill data with `op.execute`.
  3. `ALTER COLUMN SET NOT NULL` via `op.alter_column`.
- When adding a unique constraint, deduplicate existing rows first (see `002_` for
  the pattern using `ctid`).
- Never use `op.execute` with f-strings or `.format()` — always use literal SQL
  strings to avoid injection in migration scripts.
