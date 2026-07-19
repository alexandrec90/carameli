# Carameli — Local Development Guide

Self-hosted VoIP microservice powered by Telnyx + Jambonz. Drop-in replacement for Cloudli/CMV.

---

## Prerequisites

- **Docker Desktop** (running)
- That's it — everything else runs inside containers

If you only run Docker-based tasks (`Start: Full Stack`, `DB: Apply Migrations`, `Test: Run pytest`), Docker is enough.

If you also want to run all local lint/dev tasks from VS Code, install these host tools once:

| Task(s) | Required tool |
| --- | --- |
| `Start: Frontend Dev Server`, `Lint: JS`, `Lint: TypeScript`, `Lint: CSS`, `Lint: Spelling`, `Lint: Markdown` | Node.js + npm (then run `npm --prefix frontend install`) |
| `Lint: Python` | Python 3.12 + `pip install -r requirements-dev.txt` |
| `Lint: Env` | `dotenv-linter` CLI on host machine |

Note: if you plan to work on 3‑D UI components, the `three`/`@react-three` packages are included as dependencies.

### VS Code Extensions (recommended)

This repo now includes `.vscode/extensions.json`. VS Code will prompt to install recommended extensions when the workspace opens.

### `dotenv-linter` install notes

`dotenv-linter` is a standalone CLI (not bundled in `requirements.txt`):

- **Windows**: install with your preferred package manager (for example, Chocolatey or Scoop)
- **Cross-platform**: install via Cargo (`cargo install dotenv-linter`) if you already use Rust tooling

---

## Starting the Stack

```bash
docker compose up --build
```

This starts three services:

| Service | URL | Description |
| --- | --- | --- |
| Carameli API | <http://localhost:8000> | FastAPI backend |
| Carameli UI | <http://localhost:5173> | React admin dashboard |
| PostgreSQL | localhost:5432 | Database |

To run in the background (detached):

```bash
docker compose up -d --build
```

---

## Running the Database Migration

The `app` service must be running before you run migrations.

```bash
docker compose exec app alembic upgrade head
```

If the `app` service isn't running, use a one-off container instead:

```bash
docker compose run --rm app alembic upgrade head
```

---

## Backups

The `db-backup` sidecar creates a PostgreSQL custom-format dump on startup and then
nightly. Dumps are uploaded to the `carameli-backups` bucket and the newest 14 are kept;
`BACKUP_INTERVAL_SECONDS`, `BACKUP_KEEP_COUNT`, and the `BACKUP_S3_*` settings in
`.env` override those defaults. Production deployments should use separate backup
credentials and an external S3-compatible endpoint.

Verify the newest backup by restoring it into a disposable database and reading the
`call_events` table:

```bash
python scripts/backup_restore_test.py
```

Run that check at least monthly. For a real recovery, stop application writes, download
the selected dump, copy it into the PostgreSQL container, and restore it into a prepared
database:

```bash
docker compose cp carameli-20260718T010000Z.dump db:/tmp/carameli.dump
docker compose exec -T db pg_restore -U carameli -Fc --clean --if-exists -d carameli /tmp/carameli.dump
```

Test this procedure before relying on it. These dumps provide nightly recovery points,
not point-in-time recovery; move to pgBackRest or wal-g with continuous WAL archiving
when the recovery-point objective requires it.

---

## Error Tracking

Unhandled API and ARQ worker errors can be sent to either Sentry SaaS or a
Sentry-compatible GlitchTip deployment. Copy the project DSN from the selected service
into `.env`; both the `app` and `worker` services read the same settings:

```dotenv
SENTRY_DSN=https://public-key@sentry.example.com/project-id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.0
```

Leave `SENTRY_DSN` blank to keep error tracking disabled. The default sample rate keeps
performance tracing off, and the SDK's default PII collection remains off. Restart the
app and worker after changing these settings.

---

## Monitoring and alerting

Start the provisioned Prometheus, Alertmanager, Grafana, OpenTelemetry Collector, and
Uptime Kuma with the monitoring profile:

```bash
docker compose --profile monitoring up -d
```

Prometheus is available on `:9090`, Alertmanager on `:9093`, Grafana on `:3001`, and
Uptime Kuma on `:3002`. Grafana automatically loads the Prometheus and Jambonz InfluxDB
datasources plus the **Carameli Operations** dashboard. Set `GRAFANA_ADMIN_PASSWORD` and
point `ALERTMANAGER_WEBHOOK_URL` at an operator-managed paging bridge before production
use. The default receiver URL is only a local placeholder and will not deliver pages
unless a listener is running there.

On the first visit to Uptime Kuma, create the administrator account, configure a
notification channel, and add these HTTP monitors:

- Carameli from the Compose network: `http://app:8000/health`
- Carameli through its public route: the production or ngrok URL ending in `/health`
- Jambonz from the Compose network: `http://jambonz:3000/health`

For scheduled-job dead-man checks, create six **Push** monitors with push tokens
`call-event-retry`, `sms-retry`, `agent-status`, `provider-reconciliation`, `retention`,
and `backup`. Set their expected intervals to match the jobs (30 seconds, 10 minutes, or
daily, with a reasonable grace period), then configure:

```dotenv
HEARTBEAT_URL=http://uptime-kuma:3001/api/push
```

The worker and backup sidecar append the matching token to that base URL after a
successful run. Leave `HEARTBEAT_URL` blank to disable these pings. A hosted
healthchecks.io-style endpoint can be used instead if it accepts the same
`<base-url>/<job-token>` convention.

Kuma on the Carameli host is outside the application containers, but it cannot detect a
completely dead host or network. For true outside-in coverage, also monitor the public
`/health` URL from another machine or a hosted service such as UptimeRobot's free tier,
or run Kuma on a separate host.

The call-volume alert treats weekdays from 13:00 through 21:00 UTC as business hours,
which approximates 09:00–17:00 US Eastern during daylight time. Adjust the recording
rule in `prometheus-alerts.yml` when the deployment uses another timezone. A hosted
Grafana Cloud stack can scrape the same `/metrics` endpoint, but remote-write credentials
and hosted alert routing are intentionally not included here.

---

## Exploring the API

FastAPI auto-generates interactive docs at:

**<http://localhost:8000/docs>**

Authenticate with the Bearer token from `.env`:

```text
Authorization: Bearer hlUnmWwpQVyGbg8oV2sgBsMMypjoPI6Q7fq9xgj6nb8VrnKIonewB4fWspqnEtfq
```

---

## Using the Dashboard

1. Open **<http://localhost:5173>**
2. Click **"Seed Demo Customer"** on the Dashboard to create the first customer record (`vs_customer_id = 1`)
3. Navigate to **Phone Lines** or **Extensions** to provision resources

---

## Running Tests

Tests run against the live PostgreSQL container — make sure the stack is up first.

```bash
docker compose exec app pytest -v
```

---

## CI Gates and Branch Protection

The repository is wired for three CI tiers:

- `PR Gate` (fast checks on `master` pull requests and pushes)
- `Nightly` (full backend, frontend, and cross-browser coverage)
- `Weekly Hardening` (migration/resilience/mutation and reliability summary)

Merges to `master` are gated by the `Dependabot auto-merge` workflow, which waits for
`PR Gate` to succeed before merging — this repo's plan (private, no GitHub Pro) has no
branch protection. If you upgrade to GitHub Pro or make the repo public, add a branch
protection ruleset on `master` requiring the four PR Gate checks:

- `Backend unit + integration`
- `Lint`
- `Frontend unit tests`
- `Lockfile environment markers`

For weekly reporting, create and pin an open GitHub issue titled `Weekly Test Reliability Report`.
The weekly workflow auto-discovers that issue by title and posts the summary comment there.

---

## Connecting Live Providers (Optional)

Your `.env` already has provider placeholders. To test live calls and SMS:

1. Update `.env` with valid Telnyx + Jambonz credentials
2. For webhooks (call status and SMS inbound), run the VS Code task
   **Start: ngrok + Sync URLs + Recreate App/Worker**. It starts the stable dev
   domain assigned to your ngrok account, synchronizes all public URL settings,
   updates the Telnyx messaging-profile webhook when its credentials are set,
   and recreates the app and worker so they reload `.env`.

   The equivalent command is:

   ```bash
   python scripts/start-ngrok.py
   ```

3. Confirm the task reports the expected ngrok URL and a successful Telnyx
   webhook update. Without Telnyx credentials, it prints the URL to configure
   manually instead.

---

## Useful Commands

```bash
# View logs
docker compose logs app
docker compose logs -f app   # follow / tail

# Stop everything
docker compose down

# Stop and delete the database volume (full reset)
docker compose down -v

# Open a shell inside the app container
docker compose exec app bash

# Generate a new Alembic migration after changing models
docker compose exec app alembic revision --autogenerate -m "describe change"

# Roll back one migration
docker compose exec app alembic downgrade -1
```

---

## Route Reference

All API routes are prefixed with `/vsapi/1.0.0/`.

| Group | Prefix | Key Endpoints |
| --- | --- | --- |
| Customers | `/VsCustomer/` | `POST /Create`, `GET /Get/{id}`, `GET /GetPhoneLines/{id}` |
| Phone Lines | `/PhoneLine/` | `POST /Add`, `GET /GetCount/{id}`, `PUT /Deactivate`, `PUT /UpdateCallRecording` |
| Extensions | `/VsExtension/` | `POST /Add`, `GET /GetAvailable/{id}/{start}/{end}`, `PUT /Deactivate/{id}/{ext}` |
| SMS | `/VsMessaging/Sms/` | `PUT /Enable/{id}/{number}`, `PUT /Disable/{id}/{number}`, `POST /Send/{id}` |
| Voicemail Drop | `/VsMessageDrop` | `POST /VsMessageDrop` |
| SCI Routing | `/` | `POST /PostSCIbyZipCode`, `POST /UpdateSCIUserOption` |
| Pointers | `/` | `POST /AddPointerToExtension`, `DELETE /DeletePointerToExtension` |
| Area Codes | `/GetAreaCodes` | `GET /GetAreaCodes`, `GET /GetAreaCodes/{country}/{state}` |
| Webhooks | `/webhooks/` | `POST /jambonz/call-status`, `POST /telnyx/sms-inbound` |
| Health | `/health` | `GET /health` |

---

## What's Not Yet Wired Up

See [docs/prototype-roadmap.md](docs/prototype-roadmap.md) for the full VanillaSoft-prototype
gap analysis and workstreams.

| Feature | Status |
| --- | --- |
| VanillaSoft write-back on call events | HTTP POST + ARQ retry exist, but the payload/auth don't match VanillaSoft's `CloudliController` contract yet; skipped when `VANILLASOFT_WEBHOOK_URL` is blank |
| Inbound routing orchestration (SCI / pointers) | Inbound calls are answered but nothing routes them to an extension; SCI rules are stored, never consulted; `dtmf-result` handler missing |
| Inbound SMS | `message.received` webhook only logs — not persisted, not forwarded to VanillaSoft |
| DID provisioning (live) | `/PhoneLine/Add` reads `result["sid"]` but the Telnyx provider returns `provider_sid` — live purchases 502 after buying the number |
| SMS, Call Events, Settings pages | UI placeholders — API endpoints are fully functional |
| Recording → S3 storage | Dev: recording URLs stored from call-status callbacks, no S3 copy |

---

## MCP Tools

| Server | Package | Scope | Status |
| --- | --- | --- | --- |
| `postgres` | `@modelcontextprotocol/server-postgres` | USER (`~/.claude.json`) | Configured |
| `MCP_DOCKER` | `docker mcp gateway run` (Docker Desktop built-in) | USER (`~/.claude.json`) | Configured |
| `github` | `ghcr.io/github/github-mcp-server` (Docker) | USER (`~/.claude.json`) | Configured |
| `redis` | `@modelcontextprotocol/server-redis` | USER (`~/.claude.json`) | Configured — requires Redis port on localhost (see `docker-compose.override.yml`) |
| `azure-devops` | `@azure-devops/mcp` | USER (`~/.claude.json`) | Configured — org `VanillaSoftCollection` (VanillaLand's ADO project), `azcli` auth |

### Installation gotchas (VS Code extension + Windows)

1. **Config file is `~/.claude.json`**, not `settings.json` — `mcpServers` is rejected by the settings schema.
2. **USER scope only** — project-scoped entries (`projects.<path>.mcpServers`) silently fail in the VS Code extension due to drive-letter-case mismatches (`C:/` vs `c:/` as the path key).
3. **`cmd.exe /c npx` wrapper required** — bare `npx` as `"command"` doesn't resolve in the extension's process environment on Windows.
4. **Pre-install the npm package globally** — `npx -y <pkg>` downloads on first run and can exceed the 30s MCP timeout. Run `npm install -g <pkg>` once before reloading. (`@modelcontextprotocol/server-postgres` is deprecated but functional; install it anyway.)
5. **Reload Window after editing** — the extension doesn't hot-reload `~/.claude.json`.
6. **CLI "Connected" ≠ in-session** — `claude mcp list` shows Connected regardless of scope; reload and test a tool call to confirm.

### Notes

- `MCP_DOCKER` uses Docker Desktop's built-in MCP gateway (`docker mcp gateway run`) — no npm package needed. `docker` is a real binary so the `cmd.exe /c` wrapper is **not** required.
- Both servers are local-session-only (require Docker Desktop running).
- `azure-devops` uses `azcli` authentication (no token stored in config) — requires `az login --allow-no-subscriptions` once per session/token-expiry, since the VanillaSoft AAD tenant has no accessible Azure subscriptions (Azure DevOps org access doesn't need one). Re-run that command if the server starts returning auth errors.
