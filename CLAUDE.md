# Carameli

A self-hosted VoIP microservice. Manages phone lines, extensions, SMS, call recording, and call tracking via a REST API.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Language | Python 3.12 |
| Framework | FastAPI |
| Background jobs | ARQ (async, Redis-backed, separate worker process) |
| Database | PostgreSQL 18 |
| ORM / Migrations | SQLAlchemy 2 (async) + Alembic |
| Call engine | Jambonz (self-hosted, on FreeSWITCH) |
| Carrier / SIP trunk | Telnyx (wholesale) — provider-abstracted |
| Media storage | S3-compatible blob (local disk in dev) |
| Container | Docker + Docker Compose |
| Auth | Bearer API key (`Authorization: Bearer <key>`) |
| Tests | pytest + pytest-asyncio |

## Local Development

```bash
# Start everything (includes Jambonz + FreeSWITCH + rtpengine)
docker compose up

# Apply DB migrations
docker compose exec app alembic upgrade head

# Run tests
docker compose exec app pytest

# Expose webhook endpoints publicly (Jambonz + Telnyx need to reach Carameli)
ngrok http 8000
# Then set JAMBONZ_WEBHOOK_BASE_URL and TELNYX_WEBHOOK_BASE_URL in .env to the ngrok HTTPS URL
```

## Environment Variables

See `.env.example` for all vars. All settings are loaded via pydantic-settings in `app/core/config.py`.

## Call Tracking

The active call engine (Jambonz) fires a status webhook when a call ends. Carameli:

1. Validates the webhook signature
2. Writes the raw event to the `call_events` PostgreSQL table
3. Matches it to a call record and updates talk time / call attempt counters

APScheduler runs a retry job every 30 seconds for any failed writes.

## VanillaLand Reference

`../VanillaLand/` is the legacy .NET/SQL Server CRM+VoIP monolith that Carameli is designed to
replace at the telephony layer. Use it to understand existing feature contracts before implementing
or extending Carameli endpoints. Everything outside the table below is excluded from the context
window via `.claudeignore`.

### Technology mapping

| VanillaLand (legacy) | Carameli equivalent |
| --- | --- |
| ConnectMeVoice (CMV) / CloudLi | Jambonz call engine (`app/services/providers/engine/jambonz.py`) |
| Telnyx carrier (same) | Telnyx carrier provider (`app/services/providers/carrier/telnyx.py`) |
| `tblPhoneNumber` / `VoIPEntities` | `phone_lines` + `extensions` DB tables |
| `tblCallHistory` | `call_events` DB table |
| `SMSWS.asmx` web service | `/vsapi/1.0.0/VsMessaging/Sms/` routes |
| `CMVCallInfo.asmx` web service | `/webhooks/jambonz/call-status` webhook |
| `VoiceMailDropHistory` | voicemail_drop service + `/vsapi/1.0.0/VsMessageDrop` |
| IntellectiveRouting / CallerRouting | SCI routing (`app/api/vsapi/sci.py`) |
| DID provisioning (phone number lifecycle) | `app/services/did_manager.py` |

### Relevant VanillaLand paths

| Path | What to look for |
| --- | --- |
| `AppCode/VanillaSoft.Backend/ConnectMeVoice/` | Call initiation, recording, IVR, voicemail-drop business logic |
| `AppCode/VanillaSoft.Backend/SMS/` | SMS send/receive, opt-out handling |
| `AppCode/VanillaSoft.Backend/Phone/`, `PhoneNumber/` | DID provisioning, number lifecycle |
| `AppCode/VanillaSoft.Backend/Routing/`, `IntellectiveRouting/` | SCI / zip-code routing rules |
| `AppCode/VanillaSoft.Backend/Recording/` | Recording storage, retrieval, cleanup |
| `AppCode/VanillaSoft.Backend/Customer/` | Customer account structure |
| `AppCode/VanillaSoft.Model/VoIP/` | `VoIPEntities` — canonical VoIP data shapes |
| `AppCode/VanillaSoft.Model/SMS/`, `User/SMS/` | SMS message and user-level config models |
| `AppCode/VanillaSoft.Model/Recording/`, `Contact/CallHistory/` | Call record and recording models |
| `AppCode/VanillaSoft.Model/PhoneNumber/` | Phone number entity |
| `AppCode/VanillaSoft.Model/Customer/` | Customer entity |
| `AppCode/Vanillasoft.Webservice/` | ASMX service contracts Carameli's REST API replaces |
| `AppCode/ConnectMeVoice/` | CMV client — call + message-drop API surface |
| `AppCode/CMVAgentStatus*/` | Agent presence (potential future feature) |
| `AppCode/CMVRecordings*/`, `CMVUrlUploader*/` | Recording storage/upload patterns |
| `AppCode/InBoundMessaging*/` | Inbound SMS webhook handling patterns |
| `AppCode/SMSService/` | SMS processing queue |
| `AppCode/vsoft_CallComplianceSvr/` | Call compliance server |

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

- Log file: `logs/runtime/carameli.log` (10 MB cap, 5 backups)
- Format: `YYYY-MM-DD HH:MM:SS.mmm | LEVEL | module:line | message`
- Every Python module: `logger = logging.getLogger(__name__)` at module scope
- Every route handler: log entry at `INFO`, 404s at `WARNING`, errors at `ERROR`
- Frontend: `import { logger } from '../lib/logger'` — auto-ships to backend log file
- Never log secrets (`api_key`, credentials)
- A global `@app.exception_handler(Exception)` in `app/main.py` ensures all unhandled 500s are written to the log file with full stack traces — **do not remove it**; it is the primary signal for AI-assisted debugging via `logs/runtime/carameli.log`

## Tooling

See `.claude/rules/tooling.md` for VS Code task script conventions.

- Task scripts live in `scripts/` and must be PowerShell (`.ps1`) — not Bash/`.sh`
- Always invoke scripts with `pwsh` (PowerShell 7), never `powershell` (Windows PowerShell 5.1)
- Use only ASCII characters in `.ps1` files — no em-dashes, curly quotes, or other non-ASCII (they cause parse errors when the file encoding is misread)
- **Never run `docker` or `docker compose` commands directly** — provide the commands for the user to run instead

## Testing Strategy

- **Unit tests**: pytest with mocked provider interfaces (`unittest.mock.patch` at the `CarrierProvider` / `CallEngineProvider` boundary — never mock internal SDK details)
- **Integration tests**: Telnyx sandbox credentials + a local Jambonz instance (no real charges)
