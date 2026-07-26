# Phase 05 — Metrics Completion + Alerting

> Depends on the local Docker stack with the `monitoring` compose profile
> (`docker compose --profile monitoring up -d`).

Goal: turn the already-existing Prometheus + Grafana profile (`docker-compose.yml:337-361`)
into something that actually pages: an ARQ queue-depth/backlog metric, Alertmanager with
the four review-mandated alerts, and provisioned Grafana datasources/dashboard. The
review doc said "add Prometheus + Grafana" — **they exist**; this phase fills the gaps.

## Gap 1 — metrics that don't exist yet

`/metrics` today is only `prometheus-fastapi-instrumentator` HTTP metrics. Add, in the
app (exposed on the same `/metrics`):

| Metric | Type | Source |
| --- | --- | --- |
| `carameli_unposted_call_events` | Gauge | count of `call_events` where `posted = false` (cheap after phase 01's partial index) |
| `carameli_unposted_sms_messages` | Gauge | same for SMS |
| `carameli_arq_queue_depth` | Gauge | `LLEN arq:queue` via the existing redis client (`arq.constants.default_queue_name`) |
| `carameli_webhook_failures_total` | Counter | increment in the Jambonz/Telnyx webhook handlers' failure paths (find them under `app/api/webhooks/`) |

Implementation: a small `app/core/metrics.py` registering the gauges with an async
collect hook (instrumentator supports custom instrumentation callbacks; alternatively a
lightweight `/metrics`-time DB query — verify which pattern the installed
`prometheus-fastapi-instrumentator` version supports and keep the DB queries indexed-only).
Handlers import the counter from `app/core/metrics.py`.

## Gap 2 — Alertmanager + rules

1. New `alertmanager.yml` (route → receiver; start with a webhook/email receiver left as
   env-configurable placeholder — the operator fills in Slack/SMTP) and compose service
   `alertmanager` (image `prom/alertmanager`, `profiles: ["monitoring"]`, port 9093).
2. New `prometheus-alerts.yml` mounted into the Prometheus container; wire
   `rule_files:` + `alerting:` into `prometheus.yml`. Alerts (from the review):
   - **WebhookFailures**: `increase(carameli_webhook_failures_total[10m]) > 5`
   - **ArqBacklog**: `carameli_arq_queue_depth > 100 for 10m` — and/or
     `carameli_unposted_call_events > 50 for 30m` (retry loop stuck)
   - **High5xxRate**: 5xx ratio from the instrumentator's HTTP metrics `> 5% for 10m`
   - **CallVolumeFlatline**: no increase in call-event webhook requests during business
     hours — express as `absent_over_time`/`increase(...[2h]) == 0` gated on hours via
     recording rule; keep it simple and document its timezone assumption.
3. Grafana provisioning (replaces click-ops): `grafana/provisioning/datasources/` with
   Prometheus + the existing InfluxDB (Jambonz engine stats, `docker-compose.yml:146`),
   mounted into the grafana service. A starter dashboard JSON (calls/day, queue depth,
   unposted gauges, 5xx rate) under `grafana/provisioning/dashboards/`.

## Tests (same commit)

- Unit tests for `app/core/metrics.py`: gauges report seeded counts (DB fixtures per
  `.claude/rules/testing.md`); counter increments on the webhook failure path (drive the
  handler with an invalid-signature or provider-error case that already has tests —
  extend those).
- `/metrics` endpoint test: response contains the new metric names.
- YAML validity: `promtool check rules prometheus-alerts.yml` and
  `amtool check-config alertmanager.yml` via `docker run` in verification (no committed
  test needed if CI lacks the binaries — note it in the PR).

## Verify

1. Targeted pytest; `ruff`/`mypy`.
2. `docker compose --profile monitoring up -d` (**ask before restarting existing
   services**), then: Prometheus targets page shows app + alert rules loaded;
   `curl localhost:8000/metrics | grep carameli_` shows the new series; Grafana (:3001)
   auto-provisions the datasources + dashboard.
3. Force an alert: stop the worker (`docker compose stop worker` — ask first), enqueue
   events, watch `ArqBacklog`/unposted gauge climb and the alert fire in Alertmanager.
   Restart worker.

## Out of scope

- Actual paging destination credentials (Slack webhook/SMTP) — placeholder config only.
- Grafana Cloud option — README note only.
- node-exporter / postgres-exporter — nice-to-haves; add later if host metrics wanted.
