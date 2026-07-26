# Phase 03 — Database Backups (nightly pg_dump → S3) + Restore Test

> Depends on the local Docker stack (Postgres, MinIO).

Goal: close the single biggest gap in the stack. Postgres is the system of record for all
call/SMS history and has **no backup of any kind**. Deliver: a nightly `pg_dump` shipped
to the existing S3/MinIO bucket infrastructure, pruning, and a scripted restore test.
pgBackRest/wal-g (continuous WAL archiving, PITR) is the documented upgrade path, not
this phase.

## Design decisions (made)

- **Sidecar compose service, not an ARQ cron.** The app image has no `pg_dump` binary and
  shouldn't grow one; a backup job that lives inside the thing it backs up is also the
  first casualty of an app-side failure. A small dedicated service is self-contained and
  works identically in dev and prod.
- **Separate bucket** `carameli-backups` (extend `minio-init` to create it) — lifecycle
  and access policy for backups differ from recordings.
- **Format:** `pg_dump -Fc` (custom format; compressed, supports `pg_restore -j`).
- **Cadence/retention:** nightly, keep 14 dailies (prune in-script). Both env-tunable.

## Implementation

1. `backup/Dockerfile` (or `docker/backup.Dockerfile`, whichever matches repo layout):
   `FROM postgres:18-alpine` + install `minio/mc` client binary. Tiny.
2. `backup/backup.sh` (POSIX sh, runs as the container command — infinite loop:
   dump → upload → prune → sleep):
   - `pg_dump -Fc -h db -U carameli carameli > /tmp/carameli-$(date -u +%Y%m%dT%H%M%SZ).dump`
     — **direct to `db`, not pgbouncer** (transaction pooling breaks pg_dump).
   - `mc alias set target "$BACKUP_S3_ENDPOINT" "$KEY" "$SECRET"` then
     `mc cp` into `target/carameli-backups/`.
   - Prune: list, sort, delete beyond `BACKUP_KEEP_COUNT` (default 14).
   - `PGPASSWORD` from env; fail loudly (non-zero exit → container restart policy
     surfaces it in `docker compose ps`; phase 06's dead-man's-switch ping goes at the
     **end** of a successful run once that phase lands — leave a `# TODO` hook).
   - Sleep `BACKUP_INTERVAL_SECONDS` (default 86400). First run on start = a free
     backup on every stack boot; acceptable, dumps are cheap at this scale.
3. `docker-compose.yml`: new `db-backup` service — `build` the backup image,
   `depends_on: db: condition: service_healthy` and `minio` healthy, env wired to the
   same `S3_*` vars pattern as the app (but its own `BACKUP_S3_*` names so prod can
   point backups at a different endpoint than recordings).
4. Extend `minio-init` to `mc mb --ignore-existing local/carameli-backups`.
5. `scripts/backup_restore_test.py` (host-run, plain Python, no new deps): pulls the
   newest dump via `mc`/boto3-less `docker compose exec`, restores into a throwaway
   database (`createdb carameli_restore_test` on the `db` container →
   `pg_restore` → `SELECT count(*) FROM call_events` → `dropdb`). Prints PASS/FAIL.
   This is the "an unrestored backup is a hope" item — make it one command.
6. `README.md`: short "Backups" section — where dumps land, how to restore for real
   (`pg_restore -Fc -d carameli`), the pgBackRest upgrade path, and a note to schedule
   `backup_restore_test.py` (manually monthly, or CI nightly if desired later).

## Tests (same commit)

Shell + compose glue is hard to unit test; the testable surface:

- `scripts/backup_restore_test.py` gets a unit test for its argument/verdict logic with
  the docker invocations stubbed (match the style of existing `scripts/hooks/tests/`).
- A CI-friendly smoke path is optional; do not block the phase on it — the restore-test
  script run against the live dev stack is the acceptance gate.

## Verify

1. `docker compose up -d --build db-backup` (**ask the user before building on a running
   stack**), watch `docker compose logs -f db-backup` for one full
   dump→upload→prune cycle.
2. `mc ls` (or MinIO console at :9001) shows the dump in `carameli-backups`.
3. `python scripts/backup_restore_test.py` → PASS.
4. Temporarily set `BACKUP_KEEP_COUNT=1` with two dumps present → prune deletes the older.
