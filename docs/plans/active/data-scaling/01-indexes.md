# Phase 01 — Missing Indexes on `call_events` and `sms_messages`

> Depends on the local Docker stack (Postgres) for verification; the code change itself
> does not.

Goal: every per-customer / recent-history query and the 30-second unposted-retry scans
hit an index instead of a sequential scan. One Alembic migration (**012**), model edits,
tests. No behavior change.

## Query patterns to serve (verified)

| Query | Location | Columns |
| --- | --- | --- |
| Customer call history + date range | `CallEventRepo.list_for_customer` (`app/repositories/call_event_repo.py:127`) | `customer_id`, `started_at`, order by `created_at desc` |
| Per-customer summary group-bys | `CallEventRepo` summary (`:174`) | `customer_id`, `started_at` |
| Unposted call retry (every 30 s) | `CallEventRepo.get_unposted` (`:224`) | `posted = false AND created_at < cutoff` |
| Unposted SMS retry (every 30 s) | SMS repo — **read `app/repositories/sms_message_repo.py` first** and confirm its filter shape | `posted`, `created_at` (expected) |
| Customer SMS history | same repo — confirm | `customer_id`, likely `created_at` / phone numbers |

Before writing the migration, read the SMS repo and note any additional filtered columns
(e.g. `from_number`/`to_number`, `phone_line_id`); index only columns that are actually
queried — do not speculatively index the phone-number columns if nothing filters on them.

## Model changes

`app/models/call_event.py`:

- `customer_id`: add `index=True` (mandated by `.claude/rules/database.md:37`).
- `started_at`: add `index=True`.
- Add `__table_args__` with the partial index so autogenerate stays drift-free:

      __table_args__ = (
          Index(
              "ix_call_events_unposted_created_at",
              "created_at",
              postgresql_where=text("posted = false"),
          ),
      )

`app/models/sms_message.py`:

- `customer_id` and `phone_line_id`: add `index=True`.
- `created_at`: add `index=True` (recent-history ordering).
- Partial `ix_sms_messages_unposted_created_at` on `created_at` where `posted = false`,
  same `__table_args__` pattern.
- Anything extra the repo read revealed.

Rationale for partials: the retry crons scan every 30 s; a `WHERE posted = false` partial
index stays a few KB no matter how many hundreds of millions of posted rows accumulate.

## Migration (012)

- Autogenerate against the running stack (`docker compose exec -T app alembic revision
  --autogenerate -m "add growth-table indexes"`), then **review**: autogenerate may miss
  the `postgresql_where` partials — add `op.create_index(..., postgresql_unique=False,
  postgresql_where=sa.text("posted = false"))` by hand if so.
- Name indexes `ix_<table>_<column>` (matching the rule's convention) so model and DB
  agree and `alembic check` stays green.
- Plain `CREATE INDEX` is fine at current volume; note in the migration docstring that a
  production deploy on a large table would want `postgresql_concurrently=True` (which
  requires `op.get_context().autocommit_block()` and the direct—non-PgBouncer—URL).

## Tests (same commit)

- New `tests/integration/test_schema_indexes.py`: after migrations, use
  `sqlalchemy.inspect` via `conn.run_sync` to assert each expected index name exists on
  the two tables, including the partials. Follow `.claude/rules/testing.md` fixtures
  (savepoint fixture, no raw sessions).
- Run `docker compose exec -T app alembic upgrade head`, then the new test file, then
  `alembic check` to prove no drift.

## Verify

1. `ruff` + `mypy` on touched files.
2. `docker compose exec -T db psql -U carameli -c "\d call_events"` — indexes listed.
3. `EXPLAIN` the unposted query and the customer-history query — both should show index
   scans (with enough rows; on an empty dev table the planner may still seq-scan — that's
   fine, the `\d` check is the acceptance gate).
