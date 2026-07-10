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

## Environment Variables

All settings are loaded via pydantic-settings in `app/core/config.py`. See `.env.example` for all vars.

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

See `.claude/rules/vanillaland-paths.md` for the full mapping including not-yet-implemented features.

## Front-End

The frontend uses a **skin system** that fully decouples data logic from visual layout.
See `.claude/rules/skin-architecture.md` for the spec and `.claude/rules/skin-carameli.md` for the
active skin's 3D canvas design constraints. Use the `add-ui-component` skill when building new components.

| Layer | Choice |
| --- | --- |
| Component framework | React (TSX) |
| Build / bundler | Vite (per-skin code splitting via dynamic import) |
| Active skin | `carameli` (3D canvas, React Three Fiber) |

## Logging

See `.claude/rules/logging-backend.md` and `.claude/rules/logging-frontend.md`. All activity lands in `logs/runtime/carameli.log`. The global
exception handler in `app/main.py` writes all unhandled 500s to the log — do not remove it.
When an integration error is hard to place, `docs/diagnostics-error-map.md` maps every failure mode to where its evidence lands.

## Tooling

> Everything in this section needs the local Docker Desktop daemon. If it isn't running,
> make the code change and defer container/stack verification until it is (or to CI).

See `.claude/rules/tooling.md`. Running `docker` / `docker compose` directly is fine — the
CLI shares Docker Desktop's daemon, so it operates on the same containers without conflict.
Be deliberate with destructive lifecycle ops on a running stack: `down -v` wipes DB volumes
and `restart` / `up --build` can drop the user's session — confirm before those. Use `-T`
with `docker compose exec` (see tooling.md).

## MCP Tools

Configured MCP servers are documented in `README.md` (MCP Tools section). Installation
gotchas for the VS Code extension are in `.claude/projects/*/memory/mcp-vscode-gotchas.md`.

**Proactive suggestions:** If an MCP server would meaningfully help with the current task,
suggest it — mention what it enables and the install steps. It's a hassle to set up here,
so surfacing useful ones saves time.

## Guardrails

This project is vibe-coded. **Every rule below is mandatory.**

### Dependencies

Python dependencies are lockfile-managed. The human-edited floors live in three
`.in` files; the `requirements*.txt` files are **compiled, fully pinned locks —
never hand-edit them**.

| Floors file | Scope | Installed where |
| --- | --- | --- |
| `requirements.in` | runtime | prod image, container, host venv, CI |
| `requirements-test.in` (includes `-r requirements.in`) | in-container test toolchain (pytest stack, contract-test deps) | Docker `dev` image target, host venv (via dev), CI |
| `requirements-dev.in` (includes `-r requirements-test.in`) | host-only tooling (ruff, mypy, playwright, locust, …) | host venv, CI — **never the container image** |

When adding a pip package: add the floor to the right `.in` file (if the
container suite imports it → `-test`; host/CI tooling only → `-dev`), then
recompile the locks in the same commit (VS Code task "Deps: Recompile Python
Lockfiles", or
`python -m uv pip compile --universal --python-version 3.12 requirements.in -o requirements.txt`,
then `-test` with `-c requirements.txt`, then `-dev` with `-c requirements-test.txt`).
Never leave an import that depends on an unlisted package. `--universal` is
required — a non-universal compile on Windows silently drops Linux-only packages
(e.g. `uvloop`) from the container's lock. Keep host-only tooling out of
`requirements-test.in`: the Docker dev image bakes that lock, and the full dev
lock balloons it ~5x (playwright, mypy, locust alone are ~250MB).

### Cross-cutting rules (enforced by scoped rule files)

- Auth + customer scoping on every route handler — `.claude/rules/security.md`
- Model changes require a migration — `.claude/rules/migrations.md`
- Provider imports only from `base.py` — `.claude/rules/voip-providers.md`
- Webhook signatures validated before processing — `.claude/rules/webhooks.md`
- Async-only I/O, Pydantic schemas on every endpoint — `.claude/rules/python-style.md`
- Layer casing contracts (snake_case/camelCase boundaries) — `.claude/rules/naming.md`
- Frontend helper/state-derivation conventions — `.claude/rules/frontend-style.md`

## Testing

Every code change must include tests in the same commit. Every endpoint and every
testable unit of logic must have test coverage — gaps are not acceptable. If you
add or touch something that has no test, write the test in the same commit even if
the logic itself didn't change.

- New endpoint/service: cover happy path, error cases, and edge cases
- Bug fix: write a regression test first
- Mock at the `CarrierProvider` / `CallEngineProvider` boundary — never mock internal SDK details
- Integration tests use Telnyx sandbox + local Jambonz (no real charges)
- Use the `make-tests` skill to identify coverage gaps after significant changes
- DB isolation rules (savepoint fixture, no raw sessions, no teardown cleanup) — `.claude/rules/testing.md`

> Running `pytest` needs the local Postgres/Docker stack; `ruff`, `mypy`, and
> `py_compile` need the local toolchain. If those aren't available, still write the
> required tests in the same change — just leave execution to CI.

Run **targeted** tests to verify a change — the specific files or module you touched
(e.g. `pytest tests/unit/test_<module>.py`), with the local Postgres container up. Do
**not** run the whole suite on every change: it's slow and a fresh-venv full run can
surface misleading version-skew failures — leave full runs to CI. Also verify with
`ruff`, `mypy`, and `py_compile`. See `tests/CLAUDE.md`.
