---
name: check-migrations
description: 'Audits Alembic migration health: linear history, no model drift, non-empty downgrade paths. Use after modifying SQLAlchemy models or before deploying to catch drift.'
argument-hint: 'Optional: "fix" to scaffold missing downgrade bodies or stubs for drift'
---

# Skill: Check Migrations

Verify that Alembic migrations are healthy without running a full upgrade.
Three targeted checks — cheap, no ORM introspection loop.

---

## The Three Checks

| # | Name | Rule |
|---|---|---|
| 1 | **Linear history** | `alembic history` must show a single chain with no branch points |
| 2 | **Downgrade completeness** | Every migration file must have a non-empty `downgrade()` function body |
| 3 | **Model / migration drift** | `alembic check` must exit 0 (no unapplied autogenerate changes detected) |

---

## Step 1 — Run the Checks

Run all three checks in parallel inside the app container.

### Check 1 — Linear history

```bash
docker compose exec app alembic history --verbose 2>&1
```

Look for any line containing `(branchpoint)` or `(mergepoint)`. A branch point means
two migration chains diverged; a merge point means they were manually rejoined.
Either is a red flag requiring manual review.

Also verify the chain is contiguous — every revision's `down_revision` should match
the previous revision's `revision` with no gaps.

### Check 2 — Downgrade completeness

```bash
grep -rn "def downgrade" alembic/versions/*.py
```

For each migration file, read the `downgrade()` function body. Flag it if:

- The body is only `pass`
- The body is only a comment (`# TODO` etc.)
- The function is missing entirely (would be a syntax error, but worth checking)

An empty downgrade means rolling back is impossible without data loss — flag as **WARNING**.
A missing downgrade is a **VIOLATION**.

### Check 3 — Model / migration drift

```bash
docker compose exec app alembic check 2>&1
```

Exit code 0 = no drift. Any other exit code means SQLAlchemy detected model changes
not reflected in any migration. Capture and display the full output.

---

## Step 2 — Report

```text
## Migration Health Check — YYYY-MM-DD

### Check 1: Linear history
  PASS   Clean linear chain: base → 001 → 002 → head

  — or —

  VIOLATION  Branch point detected at revision abc123
             Two chains: abc123 → def456  AND  abc123 → 789ghi
             Manual resolution required — do not auto-fix.

### Check 2: Downgrade completeness
  PASS   All downgrade() functions have non-trivial bodies.

  — or —

  WARNING  alembic/versions/002_add_sci_rule_unique_constraint.py
           downgrade() body is `pass` — rollback will silently no-op.

  VIOLATION  alembic/versions/003_add_call_events.py
             downgrade() function is missing entirely.

### Check 3: Model / migration drift
  PASS   alembic check exited 0 — no unapplied model changes.

  — or —

  VIOLATION  alembic check detected drift:
             <full output from alembic check>
             Run /add-db-model to scaffold the missing migration.

---
Summary: X violation(s), Y warning(s).
```

If all checks pass, print:

```text
All migration checks passed. History is linear, downgrades are complete, no model drift.
```

---

## Step 3 — Fix (only if "fix" argument was passed)

### Downgrade body fix

For each migration with a `pass`-only or missing downgrade:

1. Read the corresponding `upgrade()` function to understand what was added.
2. Write the inverse operations in `downgrade()`:
   - `op.create_table(...)` → `op.drop_table(...)`
   - `op.add_column(...)` → `op.drop_column(...)`
   - `op.create_index(...)` → `op.drop_index(...)`
   - `op.create_unique_constraint(...)` → `op.drop_constraint(...)`
3. Edit only the `downgrade()` function — do not touch `upgrade()` or metadata.

### Drift fix

Do **not** auto-generate migrations here. Report the drift and instruct the user
to run `/add-db-model` with the affected model name to scaffold the migration properly.

### Branch point

Do **not** attempt to resolve branch points automatically. Report clearly and stop.
Branch resolution requires human judgment about which chain is canonical.

After fixing downgrade bodies, re-run Check 2 to confirm clean.

---

## Hard Rules

1. Never modify `upgrade()` functions — only `downgrade()`.
2. Never resolve branch points automatically.
3. For model drift, always defer to `/add-db-model` rather than generating migrations inline.
4. In report-only mode (no "fix" argument), never modify any file.
5. Do not run `alembic upgrade head` — this skill is read-only by default.
