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
    core/
      config.py           # Settings via pydantic-settings
      auth.py             # API key validation dependency
      database.py         # Async engine + session factory
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

The admin dashboard and any customer-facing UI follow the **"Liquid Luxury"** design system
documented in `ui-design-style-guide.md` and enforced by `.claude/rules/ui-design.md`.

| Layer | Choice |
| --- | --- |
| Styling | Tailwind CSS (bracket syntax for design tokens) |
| Component framework | React (TSX) |
| Font | Satoshi → Outfit → Inter (fallback) |
| Icons | Duo-tone, rounded caps (`#FF9F1C` primary / 35% opacity secondary) |

**Key design constraints (see `.claude/rules/ui-design.md` for full spec):**

- Aesthetic: Neumorphism + Glassmorphism hybrid on a dark warm (`#1A0F00`) background
- Colors: always gradients — never flat fills on interactive/branded elements
- Shadows: warm `rgba(26, 15, 0, ...)` tones; never plain black shadows
- Motion: `cubic-bezier(0.4, 0, 0.2, 1)`, press-and-sink buttons (`scale(0.97)`)
- Glass overlays: `backdrop-filter: blur(25px)` minimum
- Loading states: amber shimmer animation (not gray skeleton bars)

Use the `add-ui-component` skill when building new components to get a step-by-step
checklist and copy-paste examples for buttons, cards, modals, and nav elements.

## Testing Strategy

- **Unit tests**: pytest with mocked Twilio SDK (`unittest.mock.patch`)
- **Integration tests**: Twilio test credentials (no real charges, predictable magic numbers)
