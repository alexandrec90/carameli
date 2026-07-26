# Data Scaling & Ops Hardening — Implementation Plan

Source: `caramelidatascalingrecommendations.md` (stack review, 2026-07-18). Postgres stays
the foundation; these phases close the gaps that review found, ordered by leverage.

Each phase (`01`–`06`) is scoped to **one coding-agent session** and is self-contained,
but assumes this overview was read first. Execute in order — later phases reference
settings and compose services introduced by earlier ones only where explicitly noted.

---

## Current state (verified 2026-07-18)

| Area | Fact |
| --- | --- |
| Growth tables | `call_events` (one row/call, written by Jambonz call-status webhook) and `sms_messages` (full bodies, both directions). Media bytes live in S3/MinIO; DB holds URLs only. |
| Indexes | `call_events`: only unique `call_sid` (`app/models/call_event.py:26`). `sms_messages`: only unique `message_sid` (`app/models/sms_message.py:29`). No `customer_id`, time, or `posted` indexes — violates `.claude/rules/database.md` (customer_id FK must be `index=True`). |
| Retry scans | ARQ crons every 30 s scan `posted = false AND created_at < now()-1min`: `CallEventRepo.get_unposted` (`app/repositories/call_event_repo.py:224`), SMS equivalent in `app/services/sms_sync.py`. Registered in `app/services/call_sync.py:94` (`WorkerSettings.cron_jobs`). **Note: retries are ARQ crons, not APScheduler — CLAUDE.md's "APScheduler runs a retry job" line is stale.** |
| Retention | None. `.claude/rules/database.md:33` permits hard-deleting `call_events` past a retention window, but nothing implements one. Both tables grow forever. |
| Backups | **None anywhere** — no pg_dump, no WAL archiving. Biggest gap. |
| Monitoring | Prometheus + Grafana **already in compose** behind the `monitoring` profile (`docker-compose.yml:337-361`), scraping `app:8000/metrics` (`prometheus.yml`). Missing: Alertmanager, alert rules, ARQ queue-depth metric, Grafana provisioning. |
| Error tracking | Global 500 handler in `app/main.py` → rotating `logs/runtime/carameli.log` (10 MB × 5). No Sentry. |
| Redis | `redis:7-alpine`, **no volume, no appendonly** (`docker-compose.yml:173-180`) — a restart drops queued ARQ jobs. |
| Postgres | `postgres:18`, data in `pgdata` volume. App connects via PgBouncer (transaction pool); Alembic uses `DIRECT_DATABASE_URL` to bypass it. No `pg_stat_statements`. |
| Settings | All via pydantic-settings in `app/core/config.py`; document every new var in `.env.example`. |

## Phases

| Phase | File | Scope | Size |
| --- | --- | --- | --- |
| 01 | `01-indexes.md` | Missing indexes on the two growth tables + partial unposted indexes (migration 012) | S |
| 02 | `02-retention-and-s3-lifecycle.md` | Retention purge job (ARQ cron) + S3/MinIO lifecycle for recordings | M |
| 03 | `03-backups.md` | Nightly pg_dump → S3 bucket + restore-test script | M |
| 04 | `04-error-tracking-sentry.md` | Sentry (or GlitchTip) SDK wiring for app + worker | S |
| 05 | `05-metrics-alerting.md` | ARQ queue-depth gauge, Alertmanager + alert rules, Grafana provisioning | M |
| 06 | `06-ops-hardening.md` | Redis persistence, `pg_stat_statements`, Uptime Kuma, dead-man's-switch pings | S |

## Deliberately deferred (do NOT build now)

Record only; each has an explicit trigger:

- **Time-based partitioning (pg_partman)** — when either table passes ~20–50 M rows or
  retention `DELETE`s start causing bloat/vacuum pain. Biggest lever, zero new infra.
- **TimescaleDB** — alternative to hand-managed partitions; drop-in extension. Consider at
  the same trigger if compression/continuous aggregates are also wanted.
- **Analytics engine (DuckDB-over-Parquet, then ClickHouse)** — only when reporting
  becomes a product feature.
- **Kafka** — explicitly rejected; the webhook→Postgres shape doesn't need it. If event
  fan-out ever emerges, step one is **Redis Streams** (already in stack), not Kafka. The
  only "skeleton" needed is the existing seam: webhook handler + `call_event_service`.
- Also rejected: document store, Elasticsearch, Vault, Kubernetes, Loki.

## Repo guardrails that apply to every phase

- Tests in the same commit; targeted runs only
  (`docker compose exec -T app pytest tests/...`). Full suite belongs to CI.
- New pip deps: floor in the right `requirements*.in` + recompile all locks
  (`--universal`) in the same commit (see root `CLAUDE.md` → Dependencies).
- Migrations: review autogenerate output; `customer_id` FKs declare `index=True`
  (`.claude/rules/database.md`).
- Compose lifecycle ops on a running stack: confirm with the user before
  `down -v` / `up --build` / `restart`.
- New settings go in `app/core/config.py` **and** `.env.example`.
