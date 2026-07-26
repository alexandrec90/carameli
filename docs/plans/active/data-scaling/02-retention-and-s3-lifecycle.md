# Phase 02 — Retention Purge Job + S3 Lifecycle for Recordings

> Depends on the local Docker stack (Postgres, Redis, MinIO) for verification.

Goal: `call_events` and `sms_messages` stop growing forever. A daily ARQ cron hard-deletes
rows past a configurable window; MinIO/S3 lifecycle rules expire recording objects on the
same clock. Phase 01's indexes are assumed (the purge filters on `created_at`).

## Design decisions (made — don't re-litigate)

- **Delete, don't archive.** The review's Parquet-export option is deferred with the
  analytics engine. If that ever lands, it slots in before the delete in the same job.
- **Default OFF.** `retention_days: int = 0` (0 = disabled). Silently deleting history on
  self-hosted installs is worse than growth; the operator opts in via `.env`.
  Recommended production value: 450 (~15 months) — say so in `.env.example`.
- **Never delete unposted rows.** A row with `posted = false` still owes VanillaSoft a
  notification; the purge must add `posted IS TRUE` to its predicate regardless of age.
- **One shared window** for both tables and recordings. Two knobs can come later if needed.

## Backend changes

1. `app/core/config.py`: add `retention_days: int = 0`. Document in `.env.example`.
2. New `app/services/retention.py` (thin module, per `app/services/CLAUDE.md` this is a
   background job like `call_sync.py`, so it manages its own sessions via
   `async_session_factory`):
   - `async def purge_expired(ctx: dict) -> None` — no-op when `settings.retention_days
     <= 0`; otherwise computes `cutoff = utcnow - timedelta(days=retention_days)` and
     calls repo delete methods for both tables; logs counts at INFO.
3. Repo methods (repos own ORM + commit):
   - `CallEventRepo.delete_older_than(cutoff) -> int` — `DELETE WHERE created_at < cutoff
     AND posted IS TRUE`, **batched** (`LIMIT` via subquery of ids, loop until 0 rows,
     e.g. 10 000/batch) so a first-ever run on a huge table doesn't hold one giant
     transaction. Return total deleted.
   - Same on the SMS repo.
4. Register in `app/services/call_sync.py` `WorkerSettings.cron_jobs`:
   `cron(retention.purge_expired, hour={4}, minute={0}, second=0)` (off-peak, daily).

## Rule-file update (required, same change)

`.claude/rules/database.md:31-34` allows hard-deleting only `call_events` past the
retention window — it predates SMS retention. Extend that sentence to cover
`sms_messages` rows past the window, or the next audit flags this job as a violation.

## S3 / MinIO lifecycle

- Recordings bucket: `carameli-recordings`, created by the `minio-init` one-shot
  (`docker-compose.yml:383-394`).
- Extend `minio-init`'s entrypoint with an ILM rule, e.g.
  `mc ilm rule add --expire-days 450 local/carameli-recordings` (idempotent-guard it —
  `mc ilm rule ls` first or tolerate the "already exists" error).
- For real AWS S3 in production, document the equivalent lifecycle configuration (a
  paragraph in `.env.example` or `README.md` next to the S3 vars is enough — Carameli
  doesn't manage AWS account config).
- Keep the object expiry aligned with `retention_days`; note the linkage in both places.
  (DB rows carry `recording_url` pointers — rows and objects should die together.)

## Tests (same commit)

- Repo tests: rows older than cutoff deleted; newer rows kept; **unposted old rows
  kept**; batching loop terminates and returns correct count (insert > 1 batch of tiny
  rows with a small injected batch size).
- Service test: `retention_days = 0` → no deletes attempted (monkeypatch settings).
- Cron registration test: `WorkerSettings.cron_jobs` includes `purge_expired` (mirrors
  however existing cron tests assert registration — check `tests/` for the pattern used
  for `retry_unposted_events`).

## Verify

- Targeted pytest on the new test files.
- With `RETENTION_DAYS=1` in a scratch env, seed an old row (`created_at` backdated via
  raw update in the test), run `purge_expired` once manually, confirm the row is gone and
  the log line shows counts.
- `docker compose exec -T minio-init` isn't a thing (one-shot) — re-run
  `docker compose up minio-init` and check `mc ilm rule ls` output.
