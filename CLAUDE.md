# VoiceGateway

A self-hosted VoIP microservice built on Twilio. Manages phone lines, extensions, SMS, call recording, and call tracking via a REST API.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Language | Python 3.12 |
| Framework | FastAPI |
| Background jobs | APScheduler (in-process) |
| Database | PostgreSQL 18 |
| ORM / Migrations | SQLAlchemy 2 (async) + Alembic |
| VoIP provider | Twilio |
| Media storage | S3-compatible blob (local disk in dev) |
| Container | Docker + Docker Compose |
| Auth | Bearer API key (`Authorization: Bearer <key>`) |
| Tests | pytest + pytest-asyncio |

## Project Layout

```text
voicegateway/
  app/
    api/
      vsapi/              # API routes (/vsapi/1.0.0/...)
        phone_lines.py    # /PhoneLine/...
        extensions.py     # /VsExtension/...
        sms.py            # /VsMessaging/Sms/...
        customers.py      # /VsCustomer/...
        voicemail_drop.py # /VsMessageDrop
        sci.py            # /PostSCIbyZipCode, /UpdateSCIUserOption
        pointers.py       # /AddPointerToExtension, /DeletePointerToExtension
        area_codes.py     # /GetAreaCodes
      webhooks/
        call_status.py    # POST /webhooks/twilio/call-status
      vg/
        frontend_logs.py  # POST /vg/1.0.0/frontend-logs (browser log ingestion)
    core/
      config.py           # Settings via pydantic-settings
      auth.py             # API key validation dependency
      database.py         # Async engine + session factory
      logging_config.py   # Rotating file + console handler setup
    models/               # SQLAlchemy ORM models
    schemas/              # Pydantic request/response models
    services/
      twilio_provider.py  # All Twilio SDK calls
      call_sync.py        # APScheduler job for call tracking retries
    repositories/         # DB query layer (CustomerRepo, LineRepo, etc.)
  alembic/                # DB migrations
  tests/
    unit/
    integration/
  docker-compose.yml
  Dockerfile
  .env.example
```

## Local Development

```bash
# Start everything
docker compose up

# Apply DB migrations
docker compose exec app alembic upgrade head

# Run tests
docker compose exec app pytest

# Expose webhook endpoint to Twilio (needs a public URL)
ngrok http 8000
# Then set TWILIO_WEBHOOK_BASE_URL in .env to the ngrok HTTPS URL
```

## Environment Variables

See `.env.example`. Key vars:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Async PostgreSQL DSN (`postgresql+asyncpg://...`) |
| `TWILIO_ACCOUNT_SID` | Twilio account (use test SID in dev) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_WEBHOOK_BASE_URL` | Public base URL for Twilio callbacks (ngrok in dev) |
| `API_KEY_SECRET` | Validates bearer tokens from API clients |
| `LOG_LEVEL` | Root log level (`DEBUG`/`INFO`/`WARNING`/`ERROR`), default `INFO` |
| `LOG_FILE` | Rotating log file path, default `logs/voicegateway.log` |

## Route Prefixes

All routes mount under `/vsapi/1.0.0/`. Native VoiceGateway-only extensions use `/vg/1.0.0/`.

| Route Group | Prefix |
| --- | --- |
| Phone lines (DIDs) | `/vsapi/1.0.0/PhoneLine/` |
| Extensions (SIP) | `/vsapi/1.0.0/VsExtension/` |
| SMS | `/vsapi/1.0.0/VsMessaging/Sms/` |
| Customers | `/vsapi/1.0.0/VsCustomer/` |
| Voicemail drop | `/vsapi/1.0.0/VsMessageDrop` |
| SCI routing | `/vsapi/1.0.0/PostSCIbyZipCode`, `/vsapi/1.0.0/UpdateSCIUserOption` |
| Pointers | `/vsapi/1.0.0/AddPointerToExtension`, `/vsapi/1.0.0/DeletePointerToExtension` |
| Area codes | `/vsapi/1.0.0/GetAreaCodes` |
| Frontend log ingestion | `/vg/1.0.0/frontend-logs` |

Twilio webhook callbacks live under `/webhooks/twilio/...`.

## Call Tracking

Twilio fires `statusCallback` when a call ends. VoiceGateway:

1. Writes the raw event to the `call_events` PostgreSQL table
2. Matches it to a call record and updates talk time / call attempt counters

APScheduler runs a retry job every 30 seconds for any failed writes.

## MVP Scope (Phase 1)

- Customer CRUD + API key auth
- DID provisioning (add, get, deactivate)
- SMS enable/disable/send
- Outbound calling with call recording
- Call status webhook → `call_events` DB write
- Talk time / call attempt tracking
- Extension (SIP credential) management
- Docker deployment

## Front-End (Carameli UI)

The frontend uses a **skin system** that fully decouples data logic from visual layout.
Skins can use completely different tech stacks (CSS, Three.js, etc.) without touching shared code.
See `.claude/rules/skin-architecture.md` for the authoritative spec.

| Layer | Choice |
| --- | --- |
| Component framework | React (TSX) |
| Build / bundler | Vite (per-skin code splitting via dynamic import) |
| Active skin | `carameli` (3D canvas, React Three Fiber) |

### Frontend Layout

```text
frontend/src/
  hooks/               # Data layer — one hook per page, no JSX
    useDashboard.ts
    usePhoneLines.ts
    useExtensions.ts
  skins/
    types.ts           # Skin / SkinViews TypeScript interfaces
    registry.ts        # Dynamic import map (one Vite chunk per skin)
    context.tsx        # SkinProvider + useSkin()
    carameli/          # Active skin (3D "Liquid Candy Maximalism")
      index.ts         # Skin entry point / chunk boundary
      Layout.tsx
      views/           # Skin-specific page renderers (props only, no API calls)
  pages/               # Thin orchestrators: call hook → call useSkin() → render view
  api/                 # API client + TypeScript types
  lib/                 # logger, utilities
```

### Skin Design Constraints (carameli skin)

See `.claude/rules/skin-carameli.md` for the full 3D canvas spec. Quick reference:

- Entire UI inside `<Canvas>` (React Three Fiber) — no CSS-styled DOM for primary surfaces
- `MeshPhysicalMaterial` on all interactive surfaces — `meshBasicMaterial` forbidden
- Real panel depth via `RoundedBox` (z ≥ `0.18`) — no flat planes as UI panels
- 3D extruded text (`Text3D` with `bevelEnabled`, `height ≥ 0.2`)
- Spring physics for all motion (`@react-spring/three`) — no CSS transitions
- Warm lights only — minimum 3 colored point lights, no cold/white lights
- Fluid vertex-shader background, always moving
- Post-processing always on: Bloom + ChromaticAberration + Vignette

Use the `add-ui-component` skill when building new components to get a step-by-step
checklist and copy-paste examples for buttons, cards, modals, and nav elements.

## Logging

All backend and frontend activity is written to a single rotating log file.
See `.claude/rules/logging.md` for the full spec.

**Quick reference:**

- Log file: `logs/voicegateway.log` (10 MB cap, 5 backups)
- Format: `YYYY-MM-DD HH:MM:SS.mmm | LEVEL | module:line | message`
- Every Python module: `logger = logging.getLogger(__name__)` at module scope
- Every route handler: log entry at `INFO`, 404s at `WARNING`, errors at `ERROR`
- Frontend: `import { logger } from '../lib/logger'` — auto-ships to backend log file
- Never log secrets (`api_key`, `twilio_auth_token`, credentials)

## Testing Strategy

- **Unit tests**: pytest with mocked Twilio SDK (`unittest.mock.patch`)
- **Integration tests**: Twilio test credentials (no real charges, predictable magic numbers)
