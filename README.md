# Carameli — Local Development Guide

Self-hosted VoIP microservice powered by Telnyx + Jambonz. Drop-in replacement for the
legacy carrier integration it supersedes.

---

## Prerequisites

- **Docker Desktop** (running)
- That's it — everything else runs inside containers

If you stay on the Docker-backed development path (`Start: Full Stack`,
`python scripts/docker-migrate.py`, and the workspace `Test: Run Suite` task), Docker is enough.

If you also want to run all local lint/dev tasks from VS Code, install these host tools once:

| Workflow | Required tool |
| --- | --- |
| `Start: Frontend + Preview` and the workspace lint task's JS/CSS/docs passes | Node.js + npm (then run `npm --prefix frontend install`) |
| The workspace lint task's Python passes | Python (the `FROM python:` tag in `Dockerfile`) + `pip install -r requirements-dev.txt` |
| The workspace lint task's environment pass | `dotenv-linter` CLI on host machine |

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

The Jambonz/FreeSWITCH/rtpengine telephony services only start when
`COMPOSE_PROFILES=telephony` is set in `.env` (it ships in `.env.example` — if you
copied `.env` before that line existed, add it). Without it you get the slim stack:
db, pgbouncer, redis, app, worker, frontend, minio.

---

## Parallel Worktrees (two agents, two stacks)

Two coding agents can work on separate branches at once, each with its own checkout
and its own Docker stack. Everything expensive is shared — the `.git` object store
(via `git worktree`), Docker image layers, and (with `uv`) the Python package cache —
so a second stack costs well under 1 GB, mostly the frontend `node_modules` volume
and a fresh Postgres volume. Volumes, network, and containers are namespaced by the
Compose project name, so data stays fully independent.

Setup, from the primary checkout:

```bash
git worktree add ../carameli-b <branch-name>
cd ../carameli-b
cp ../carameli/.env .env            # then edit — see below
uv venv --python <the FROM python: tag in Dockerfile>   # MUST match the image + locks
uv pip sync requirements-dev.txt              # hardlinks from uv's global cache
docker compose up -d                # slim stack on offset ports
```

In the copied `.env`, set the worktree block (template in `.env.example`):

```bash
COMPOSE_PROJECT_NAME=carameli-b   # MUST equal the worktree directory name
# COMPOSE_PROFILES=telephony      # REMOVE — telephony runs in the primary stack only
APP_HOST_PORT=8002
FRONTEND_HOST_PORT=5175
DB_HOST_PORT=5434
REDIS_HOST_PORT=6381
MINIO_HOST_PORT=9002
MINIO_CONSOLE_HOST_PORT=9042
```

> **Do not pick these by hand.** They come from `ports.toml` in
> [devkit](https://github.com/alexandrec90/devkit) — the machine-wide registry of which
> checkout owns which host port. Each checkout holds one **slot** (`carameli` = 0,
> `ibkr_trader` = 1, `carameli-b` = 2) and every port is `conventional_base + slot`.
> Regenerate the block instead of editing it:
>
> ```bash
> python <devkit>/scripts/devkit_ports.py carameli-b
> ```
>
> This paragraph replaces a hand-maintained list that had already drifted: it used to
> say `DB_HOST_PORT=5433`, which is the port `ibkr_trader`'s stack publishes, so
> anyone following it literally would have collided the two stacks. The real `.env`
> was on 5434 — the prose was what was wrong, and prose is exactly what a registry
> stops being load-bearing.
>
> **An existing `carameli-b/.env` predates the registry** and is on 8001/5174/6380/9003
> for app/frontend/redis/minio-console (its db and minio already agree). Nothing is
> broken — those ports collide with nothing today — but they are not slot 2, so
> re-sync them from the command above the next time that stack is recreated.

Rules that keep the stacks independent:

- **`COMPOSE_PROJECT_NAME` must equal the directory name.** It namespaces the stack
  and tags the locally-built images (`carameli-app-<project>` and
  `carameli-db-backup-<project>`, so parallel builds from diverging branches can't
  clobber each other), and `scripts/docker_common.py` reads it for `docker ps` filtering.
- **Telephony is single-instance per machine** — rtpengine uses host networking
  (fixed ng port 2223, RTP range 10000–10100), so only the primary stack runs the
  `telephony` profile. Tests don't need it: they mock at the `CallEngineProvider`
  boundary. Live-call/webhook work happens in the primary worktree.
- **Every `*_HOST_PORT` offset is required** while the primary stack is up, or
  `docker compose up` fails with "port is already allocated".
- **Default-port tooling stays in the primary worktree:** `scripts/run-e2e.py`,
  `scripts/run-ci.py`, `scripts/run-load.py` hardcode `localhost:8000`/`5173`, and the
  `monitoring` profile's host ports are fixed. `scripts/run-tests.py`, `pytest`,
  and the linters work per-worktree (compose exec targets the cwd's project).
- **`docker compose down -v` is project-scoped** (safe to reset one stack), but
  daemon-wide commands like `docker system prune` hit both stacks — don't run them
  while the other agent's stack is up.
- **Telemetry export is shared, not offset.** `OTEL_EXPORTER_OTLP_ENDPOINT`
  (`http://localhost:4318`, set in `.claude/settings.json`) is the same for both
  CLIs — the `*_HOST_PORT` offsets don't cover it. That's fine when a single
  collector listens on 4318 (both agents' metrics/logs land there together); just
  don't expect per-worktree isolation of telemetry, and if you run a per-worktree
  collector, offset its port and override the env var in that worktree.

To incorporate changes merged by another worktree, first commit the current worktree's
changes, then fetch and rebase the checked-out branch onto `origin/master`:
`git fetch origin && git rebase origin/master`. If Git reports conflicts, resolve them
and run `git rebase --continue`, or restore the pre-sync state with `git rebase --abort`.
Rebasing changes the IDs of local commits that are replayed.

**Automatic drift control (local sessions only, no manual command).** The `SessionStart`
hook (`.claude/hooks/session-start.sh`) runs `scripts/hooks/session-sync.py` once at the
start of every **local** Claude Code session, so each session begins rebased on the latest
`origin/master`. It refuses a dirty tree (a silent no-op whenever you have uncommitted work
— it never touches your edits), auto-aborts and leaves the branch untouched on conflicts,
and passes `--gpg-sign` when `commit.gpgsign` is set so replayed commits stay Verified.
**It never runs in cloud/remote (Claude Code on the web) sessions** — there the platform
owns the branch lifecycle, and rebasing from inside would rewrite SHAs, diverge from the
remote, and strip signatures. Run these one-time git settings on each machine (they need
no per-session command). **They are effectively required once two agents run in parallel:**
both branches rebase onto a fast-moving `origin/master`, so the same conflicts recur across
sessions (rerere replays their resolutions) and a stale `origin/master` makes every rebase
conflict more (maintenance keeps it fresh in the background):

```bash
git config --global rerere.enabled true   # resolve each recurring conflict once, reused across rebases
git maintenance start                      # periodic background fetch keeps origin/master fresh
```

### Task lifecycle: fresh branch in, PR out

For the vibe-coding loop where every task lands its own small PR to `master`, the
lifecycle is automated at both ends and stays isolated per task. **In steady state you
only ever type `/ship`** — the start of the next task is automatic:

1. **Start (automatic after the previous `/ship`).** The `UserPromptSubmit` hook
   (`scripts/hooks/branch-per-task.py`) cuts a fresh `claude/<slug>-<mmdd>` branch off the
   latest `origin/master` on two safe triggers: sitting on `master` (primary checkout), or
   sitting on the branch `/ship` just shipped with a clean tree. `/ship` records the shipped
   branch in a per-worktree marker (`.git/.../carameli-shipped`); the hook consumes it and
   clears it, so it fires exactly once and never mid-task. This makes the worktree case
   automatic: after you ship, your next prompt starts a fresh branch on its own.
   - **`/task "<description>"`** (`scripts/start-task.py`) is the manual override for the
     cases the marker can't cover — the first task of a fresh checkout, or resuming after
     abandoning work without shipping. Creating a *new* branch off `origin/master` is allowed
     in a worktree even while `master` is checked out in the primary tree. Refuses a dirty
     tree — `/ship` or stash first. (Fully automatic staleness detection isn't safe: the local
     signals can't tell a freshly-cut empty branch from a merged one, which is why the marker,
     set by an explicit ship, is the trigger rather than a guess.)
2. **Work.** The Stop hook (`scripts/hooks/stop.py`) reproduces the PR-gate checks on the
   diff at each turn and relays failures back into the session, so they are fixed in-context
   rather than after a CI round-trip.
3. **Finish (explicit — the one command you type).** Run **`/ship`** when the task is done:
   it pre-flights lint, commits, pushes (with retry), drops the shipped marker, opens a PR
   against `master`, and offers to subscribe the session to the PR's CI/review activity for
   autofix. `/ship` is explicit-only so a PR is never opened on half-finished work;
   `scripts/ship.py` owns the tested mechanics.

Checks stay layered by purpose, not merged into one hook: pre-commit holds only what CI
*can't* own (secret scanning + the Codex context generator), the Stop hook is the in-session
CI mirror, and the PR Gate is the authoritative gate that `dependabot-automerge.yml` waits on.

### Claude/Codex compatibility synchronization

Codex reads the repository's `CLAUDE.md` files through the configured project-document
fallback, so instructions have no duplicate. Repository skills and hooks still require
Codex-specific paths. The `sync-codex` pre-commit hook runs
`scripts/sync-codex-context.py`, which mirrors `.claude/skills/` to `.agents/skills/`
and regenerates `.codex/hooks.json` through `scripts/sync-codex-hooks.py`; the installed
Git hook stages generated changes on retry. PR Gate independently reruns the same
generator and fails on drift.

The mandatory hook test suite also loads the real settings, regenerates Codex hooks in
memory, and checks the committed output, handler paths, adapter wrapping, explicit
unsupported-event/matcher allowlists, and the expected event/matcher topology. Adding a
new Claude hook event therefore fails generation until it is deliberately classified as
supported or unsupported; changing the generated topology requires updating the contract
snapshot after checking Codex compatibility.

Run the deterministic checks locally with:

```bash
python scripts/sync-codex-context.py
pytest scripts/hooks/tests/test_sync_codex_hooks.py scripts/hooks/tests/test_codex_hooks_contract.py -q
```

An additional live smoke test launches an authenticated, ephemeral `codex exec` session
inside a temporary Git repository and verifies generated `SessionStart`,
`UserPromptSubmit`, and `Stop` hooks. It carries the `paid` marker and is excluded by the
default `not paid` test policy because it uses model capacity and depends on Codex
authentication. Opt in explicitly with:

```bash
pytest scripts/hooks/tests/test_codex_hooks_live.py -q -m codex_live
```

Tearing down: `docker compose down -v` inside the worktree, then
`git worktree remove ../carameli-b`, then remove its built images:
`docker image rm carameli-app-carameli-b carameli-db-backup-carameli-b`.

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
The weekly workflow auto-discovers that issue by title and posts the summary comment there
(built by `scripts/weekly_summary.py`). **That issue is required**: with no match, the
`Weekly reliability summary` job fails rather than passing green with the report undelivered.

### Failing checks never open issues

No workflow in this repo files a GitHub issue when something breaks — **a red run is the
alert**. On a PR the failing check plus the uploaded `logs/lint-errors.log` /
`logs/test-failures.log` artifacts are the signal, and the author is already watching; on
the scheduled `Nightly` / `Weekly Hardening` suites, the failed run itself is what needs
looking at. Auto-filing duplicates a signal that already exists, needs closing by hand, and
goes stale the moment the branch is fixed. Issues here are for durable trackers a human
opens: quarantined tests, and the pinned weekly report above.

The corollary is that a check must actually fail when it has nothing useful to say. A step
that prints a warning and exits 0 is the failure mode this rule exists to prevent.

---

## Connecting Live Providers (Optional)

Your `.env` already has provider placeholders. To test live calls and SMS:

Before enabling live traffic, run the two-sided
[CRM connectivity preflight](docs/operations/crm-connectivity-preflight.md)
to identify which HTTPS, SQL Server, Event Log, and file-log channels are actually
reachable and readable.

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

See [docs/prototype-roadmap.md](docs/prototype-roadmap.md) for the full CRM-prototype
gap analysis and workstreams.

| Feature | Status |
| --- | --- |
| CRM write-back on call events | HTTP POST + ARQ retry exist, but the payload/auth don't match CRM's `legacy notify controller` contract yet; skipped when `CRM_WEBHOOK_URL` is blank |
| Inbound routing orchestration (SCI / pointers) | Inbound calls are answered but nothing routes them to an extension; SCI rules are stored, never consulted; `dtmf-result` handler missing |
| Inbound SMS | `message.received` webhook only logs — not persisted, not forwarded to CRM |
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
| `azure-devops` | `@azure-devops/mcp` | USER (`~/.claude.json`) | Configured — org `CRMCollection` (LegacyCRM's ADO project), `azcli` auth |

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
- `azure-devops` uses `azcli` authentication (no token stored in config) — requires `az login --allow-no-subscriptions` once per session/token-expiry, since the CRM AAD tenant has no accessible Azure subscriptions (Azure DevOps org access doesn't need one). Re-run that command if the server starts returning auth errors.
