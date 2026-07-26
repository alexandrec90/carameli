# Phase 06 — Small Ops Hardening Bundle

> Depends on the local Docker stack. Every item here touches `docker-compose.yml` on a
> running stack — **confirm with the user before `up -d` / restarts** (session-drop risk).

Four small, independent fixes bundled into one session. Each is its own commit.

## 1. Redis persistence (one-liner, do first)

`docker-compose.yml:173-180` — the `redis` service has no volume and no AOF; a restart
drops queued ARQ jobs (unposted retries survive via the DB `posted` flag, but queued
one-off jobs and cron state don't).

- Add `command: ["redis-server", "--appendonly", "yes"]` and a `redisdata:/data` volume
  (+ declare `redisdata` in top-level `volumes:`).
- Note: Jambonz also uses this Redis; AOF is safe for it.
- Test/verify: `docker compose up -d redis` (ask first) →
  `docker compose exec -T redis redis-cli config get appendonly` → `yes`; write a key,
  `docker compose restart redis`, key survives.

## 2. `pg_stat_statements`

- `db` service: `command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements"]`.
- Enable per-database via migration **013** (`CREATE EXTENSION IF NOT EXISTS
  pg_stat_statements;` — downgrade drops it). A migration (not manual psql) so every
  environment gets it; requires the preload flag to be live first, so document ordering
  in the migration docstring: recreate `db` container, then `alembic upgrade`.
- Restarting `db` requires user confirmation (drops connections).
- Verify: `docker compose exec -T db psql -U carameli -c "select count(*) from
  pg_stat_statements"` returns rows after some traffic.
- Test: extend phase 01's schema test (or a new one) asserting the extension exists.

## 3. Uptime Kuma (outside-in probes)

- New compose service `uptime-kuma` (image `louislam/uptime-kuma:1`,
  `profiles: ["monitoring"]`, volume `kumadata:/app/data`, port `3002:3001` — 3001 is
  taken by Grafana).
- Monitors themselves are configured in its UI (SQLite state in the volume) — document
  in README which to create: `http://app:8000/health`, the public ngrok/production URL,
  Jambonz `:3000/health`.
- Caveat to state in README: on the same host it's only *container*-level outside-in; a
  truly dead host needs a probe from elsewhere (free UptimeRobot tier or Kuma on another
  box). This phase ships the self-hosted piece and documents the external option.
- No unit tests (pure compose); verification = service healthy + a monitor firing on
  `docker compose stop app` (ask first).

## 4. Dead-man's-switch pings from the scheduled jobs

A silently dead worker/scheduler currently just lets counters go stale.

- `app/core/config.py` + `.env.example`: `heartbeat_url: str = ""` (healthchecks.io-style;
  empty = disabled). Self-hosted option: Uptime Kuma's "push" monitor type gives a ping
  URL — pairs with item 3.
- New `app/core/heartbeat.py`: `async def ping(slug: str = "") -> None` — fire-and-forget
  `httpx.AsyncClient` GET with a short timeout, swallow+log failures at WARNING (a
  heartbeat must never break the job it instruments).
- Call at the **end** of each cron in `WorkerSettings.cron_jobs`
  (`app/services/call_sync.py:94`) — success-only, so a crashing cron stops pinging.
  Wire the phase 03 backup script's TODO hook (`curl "$HEARTBEAT_URL"` on success) if
  phase 03 has landed.
- Tests: ping no-ops on empty URL; ping swallows connection errors; cron function still
  succeeds when ping fails (monkeypatch httpx); ping called after successful cron run.

## Order & guardrails

Do 1 → 2 → 3 → 4 (2 needs a db restart — batch the confirmations). Python changes follow
the usual rules: targeted pytest in-container, `ruff`, `mypy`, settings documented in
`.env.example`.
