# Carameli

Self-hosted VoIP service for phone lines, extensions, SMS, call control, recordings,
and VanillaSoft-compatible APIs.

## Stack

| Layer | Choice |
| --- | --- |
| Backend | Python, FastAPI, Pydantic, SQLAlchemy async |
| Jobs | ARQ with Redis |
| Database | PostgreSQL, Alembic migrations |
| Providers | Telnyx carrier, Jambonz call engine |
| Frontend | React, TypeScript, Vite, per-skin dynamic imports |
| Runtime | Docker Compose; S3-compatible media storage |

Settings come from `app/core/config.py`; `.env.example` documents the environment.
Python dependency floors live in `requirements*.in`; compiled `requirements*.txt`
files are generated locks and must never be hand-edited.

**No version numbers in prose.** The table above names technologies, not releases, and
so should every other instruction file here. Each pin lives in the file that enforces
it — `Dockerfile`, `docker-compose.yml`, `requirements*.in`, `frontend/package.json` —
so point at that file instead of restating the number. A version copied into Markdown
is unenforced: nothing fails when it drifts, and the stale copy then reads as policy
and gets defended as one.

## Instruction ownership

DevKit owns `.claude/rules/engineering.md`, `.claude/rules/authoring.md`, and the
`ship` skill. Carameli owns this file, nested `CLAUDE.md` files, the `add-skin` skill,
and its domain rules.

Read the scoped rules when touching their paths:

- tenant authentication and customer isolation: `.claude/rules/security.md`
- skin contracts and visual systems: `.claude/rules/skin-*.md`
- carrier/call-engine boundaries: `.claude/rules/voip-providers.md`
- inbound callback authentication: `.claude/rules/webhooks.md`

## Architecture

```text
HTTP handler -> service/workflow -> repository -> PostgreSQL
      |                |
      +-> provider Protocol <- Telnyx/Jambonz implementation
```

- `app/api/` owns HTTP/auth concerns and translates domain/provider failures.
- `app/services/` owns application workflows and ARQ jobs.
- `app/repositories/` owns ORM persistence and commits.
- `app/services/providers/base.py` is the external-provider contract.
- `frontend/src/hooks/` owns data/state; skins own presentation only.

All backend and ingested frontend activity goes through the configured logging stack;
do not create ad-hoc log files or log credentials, API keys, message bodies, or raw
webhook payloads.

## VanillaSoft compatibility

`../VanillaLand/` is the legacy contract reference. Inspect it when implementing or
changing a compatibility endpoint; do not copy its architecture into Carameli.

| Legacy area | Carameli location |
| --- | --- |
| ConnectMeVoice / CloudLi providers | `app/services/providers/` |
| Phone numbers and extensions | models/repos/services for `phone_line` and `extension` |
| Call history | `call_events` |
| SMS ASMX contract | `app/api/vsapi/sms.py` |
| Call-status callbacks | `app/api/webhooks/call_status.py` |
| SCI routing | `app/api/vsapi/sci.py` |

Useful legacy roots include `VanillaSoft.Backend/ConnectMeVoice`, `CMVClarity`,
`SMS`, `PhoneNumber`, `Recording`, `VanillaSoft.Model/VoIP`,
`Vanillasoft.Webservice`, and `VanillaSoft.VoipApi` under `../VanillaLand/AppCode/`.

`docs/reference/vanillaland-scope.md` maps the whole tree — which subtrees are worth
reading and which are CRM surface with no VoIP content. Read it before going in; it is
a large codebase and the relevant slice is thin.

When Carameli is remote and VanillaLand runs locally in IIS, the log locations and the
usable test suite both change: `docs/operations/local-integration-testing.md` and the free
`tests/local_e2e/` suite, not `tests/live_e2e/`.

## Local workflow

Docker Desktop is required for database-backed tests and stack operations. Check
`docker ps` first. Telephony services are opt-in with `--profile telephony` and may run
only in the primary worktree because rtpengine uses host networking. That profile
ships no SBC and no feature server, so a softphone cannot register against it;
putting a real phone on an extension is `docs/operations/softphone-demo.md`.

Avoid destructive or disruptive lifecycle commands without confirmation:

- `docker compose down -v` deletes database volumes.
- `restart` and `up --build` can interrupt the user's active session.
- use `docker compose exec -T` from scripts and automation.

Run focused verification for changed behavior. Typical commands:

```text
python scripts/lint-all.py --changed
python scripts/run-tests.py --changed
npm --prefix frontend run test:run
npm --prefix frontend run lint
```

The frontend has no `typecheck` script; type checking is `lint:types`
(`tsc --noEmit`). Run the whole `lint` rather than that one part: it also chains
`lint:eslint`, `lint:css` and `lint:spelling`, and cspell rejects unknown words in
`.ts`/`.tsx` too, so an ordinary identifier fails CI having passed `lint:types`.

The default pytest configuration excludes every `paid` test. Sandbox, chargeable,
and live-provider tiers require explicit opt-in; never broaden a free aggregate to
include them.

The host venv must run **the same Python the image runs** — that version is coordinated
across the `FROM python:` tag in `Dockerfile`, the uv-compiled locks, `mypy.ini`,
`ruff.toml`, and CI. Read the tag, then create the venv with
`uv venv --python <that version>`; a bare `uv venv` silently takes the machine default
and gives you a venv the container does not match.

`logs/` holds per-run failure artifacts, and `scripts/prune-logs.py` bounds its growth
from the SessionStart hook. The current artifacts (`lint-errors.log`,
`test-failures.log`, ...) are protected from pruning at any age — the runners read a
missing artifact as "clean", so deleting one reports green having checked nothing.
Durable captures belong in `artifacts/`, local-only material in `.local/`.
