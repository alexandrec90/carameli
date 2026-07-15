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
2. For webhooks (call status and SMS inbound), expose the API via ngrok:

   ```bash
   ngrok http 8000
   ```

3. Set `JAMBONZ_WEBHOOK_BASE_URL` and `TELNYX_WEBHOOK_BASE_URL` in `.env` to the ngrok HTTPS URL
4. Restart the app:

   ```bash
   docker compose restart app
   ```

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
