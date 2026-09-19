# Carameli

Self-hosted VoIP service for phone lines, extensions, SMS, call control, recordings,
and CRM-compatible APIs.

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

## CRM compatibility

`../legacy-crm/` is the legacy contract reference. Inspect it when implementing or
changing a compatibility endpoint; do not copy its architecture into Carameli.

| Legacy area | Carameli location |
| --- | --- |
| Legacy carrier providers | `app/services/providers/` |
| Phone numbers and extensions | models/repos/services for `phone_line` and `extension` |
| Call history | `call_events` |
| SMS ASMX contract | `app/api/vsapi/sms.py` |
| Call-status callbacks | `app/api/webhooks/call_status.py` |
| SCI routing | `app/api/vsapi/sci.py` |

The useful roots under `../legacy-crm/AppCode/` are the VoIP backend, the clarity API,
and the SMS, phone-number, recording, VoIP-model, web-service and VoIP-API projects.
The rest of that tree is CRM surface with no VoIP content, so it is a large codebase
with a thin relevant slice — read narrowly.

That checkout is a third party's licensed source. Read it to match a contract; never
copy its code, its file layout, or its internal type names into this repository, and
keep its identifiers out of commits, comments and documentation here.

When Carameli is remote and LegacyCRM runs locally in IIS, the log locations and the
usable test suite both change: `docs/operations/local-integration-testing.md` and the free
`tests/local_e2e/` suite, not `tests/live_e2e/`.

## Local workflow

**A fresh worktree is not provisioned — run `python scripts/bootstrap.py` first.** A
linked worktree checks out tracked files only, so it has no `.venv` and no
`node_modules`, and the recurring cost of that was not the install: it was agents
reading `lint-all.py`'s red as a lint failure, working out that the red was one absent
binary, installing that binary by hand, and leaving every other check in the worktree to
fail the same way. `scripts/preflight.py` now stops the runners with this command
instead, and `bootstrap.py` does all of it — the venv on the interpreter the
`FROM python:` tag pins, the dev lock, and `npm ci`.

Docker Desktop is required for database-backed tests and stack operations. Check
`docker ps` first. Telephony services are opt-in with `--profile telephony` and may run
only in the primary worktree because rtpengine uses host networking. That profile
ships no SBC and no feature server, so a softphone cannot register against it;
putting a real phone on an extension is `docs/operations/softphone-demo.md`.

**Start the stack with `python scripts/docker-up.py`, not Docker Desktop's start button.**
That button issues `docker compose start`, which never creates a network, so after the
daemon loses its network state — Docker Desktop's backend exiting overnight has done it
twice here — every press fails with `network <hex id> not found` and the stack cannot be
started from the UI at all. Plain `up -d` does not heal it either: Compose reads the
config as unchanged, reuses the container, and start fails on the same dead ID.
`docker-up.py` detects that message and retries once with `--force-recreate`, which
rebuilds the container objects against the new network. Named volumes are untouched by
container recreation, so `carameli_pgdata` survives it; the tell that this is what
happened, rather than a prune, is the built-in `bridge` network coming back with a new ID.

Avoid destructive or disruptive lifecycle commands without confirmation:

- `docker compose down -v` deletes database volumes.
- `restart` and `up --build` can interrupt the user's active session.
- use `docker compose exec -T` from scripts and automation.

**The `db-backup` service is not a recovery path for the volumes being lost.** It dumps
into MinIO, and MinIO's storage is the `carameli_miniodata` *Docker volume* — same
daemon, same disk as `carameli_pgdata` — so anything that takes one takes the other.
`scripts/db-snapshot.py` (`save` / `list` / `restore`) is the off-volume copy: it writes
to `.local/db-snapshots/` on the host, which no prune, `down -v` or box reap reaches.
Take one before anything that touches the database.

Every snapshot carries a row-count manifest, and `list` prints `(EMPTY)` for a dump that
holds none. That is the failure this exists to make visible rather than a nicety: on
2026-08-27 the only dump in MinIO was a valid archive that restored cleanly and contained
zero rows in every table, because it had been taken just after the database was emptied,
and nothing about it said so. `restore` refuses such a snapshot unless asked with
`--allow-empty`.

DB-backed tests read `DATABASE_URL` from `.env` and TRUNCATE every table before each
run, so the database they are pointed at is destroyed. **`tests/conftest.py` refuses to
run unless something marks that database disposable**: `CI` is set, the name ends in
`_test`, or `CARAMELI_ALLOW_DB_TRUNCATE=1` is exported. `carameli_test` exists for this
and `.devkit.toml` names it, so the harness path is safe by default; a bare `pytest`
with a populated `.env` now stops with the target named instead of emptying it.

The paragraph this replaces said the same thing as advice -- point a worktree's `.env`
at its own `DB_HOST_PORT` -- and advice is what failed: on 2026-08-20 a bare `pytest`
inside a box emptied the primary stack's `carameli` database anyway, because a box
seeds its `.env` from the source checkout and so names the primary's port, and nothing
in the run said otherwise. The guidance is still right and still worth following; the
guard is what makes it hold when nobody does.

Run focused verification for changed behavior. Typical commands:

```text
python scripts/lint-all.py --changed
python scripts/run-tests.py --changed
npm --prefix frontend run test:run
npm --prefix frontend run lint
npm --prefix frontend run test:bundle
```

The frontend has no `typecheck` script; type checking is `lint:types`
(`tsc --noEmit`). Run the whole `lint` rather than that one part: it also chains
`lint:eslint`, `lint:css`, `lint:spelling` and `lint:deadweight`, and cspell rejects
unknown words in `.ts`/`.tsx` too, so an ordinary identifier fails CI having passed
`lint:types`.

`test:bundle` builds and then measures what the build produced against the ratchets in
`frontend/bundlePolicy.ts`. It is separate from `test:run` because it needs a `dist/`
and fails without one. It, `assetPolicy.ts` and `lint:deadweight` (knip) are the three
non-overlapping payload budgets; `frontend/CLAUDE.md` says which covers what.

It is also the `bundle-budgets` target of `scripts/run-tests.py`, so it runs in `--all`
alongside pytest, the hook tests and vitest, and is one of the choices the desktop
*Test: Run Carameli Target — free* task offers. A budget only reachable by typing an
npm script is a budget that gets checked when the PR gate says no, which is late.

The default pytest configuration excludes every `paid` test. Sandbox, chargeable,
and live-provider tiers require explicit opt-in; never broaden a free aggregate to
include them.

The host venv must run **the same Python the image runs** — that version is coordinated
across the `FROM python:` tag in `Dockerfile`, the uv-compiled locks, `mypy.ini`,
`ruff.toml`, and CI. `scripts/bootstrap.py` reads the tag and creates the venv with
`uv venv --python <that version>`, which is why it is the entry point rather than one
step of an install anyone types: a bare `uv venv`, and `python -m venv` in any form,
silently take the machine default and give you a venv the container does not match.

**`.python-version` is the one copy anything else reads.** Scripts take it from
`script_common.pinned_python()`, workflows from `actions/setup-python`'s
`python-version-file`, and `mypy.ini` — which can read no file — is gated against it by
`tests/unit/test_python_version_pin.py`. A version spelled out anywhere else is not a
duplicate of the pin but a *second* pin, and it is found the way the first one was: a
lock compiled for an interpreter the image does not run, surfacing as a dependency
failure. The one deliberate literal is the `FROM python:` tag, which the pin is tested
against.

**Node is coordinated the same way and had nothing saying so.** The pin is
`.github/actions/setup-node-env/action.yml`'s `node-version`, mirrored in `.nvmrc` and in
the `frontend` service's `image:` so the mismatch is visible before a test run rather than
after one. `tests/unit/test_node_version_pin.py` is what keeps the three in step, and it
checks the pin against the `engines.node` of every package in `frontend/package-lock.json`
— because the pin is not free to lag: a dependency bump that raises a floor above it takes
out an `npm run lint` step, and reads as a broken lint rather than a stale pin.
`frontend/.npmrc` turns `engine-strict` on so `npm ci` refuses that tree outright instead
of installing it and failing at the point of use.

**`npm run lint` and the gate must be the same set of checks.** They were not: `cspell`
and `knip` lived only in the npm chain, so they ran when a person typed the command and in
no CI job, pre-commit hook or ship gate — which is how a cspell that could not start on the
pinned interpreter merged green. Everything automated goes through `scripts/lint-all.py`,
so a check absent from its registry is enforced nowhere, and one whose report name has no
`LINT_SECTIONS` entry in `scripts/diagnostics.py` is worse: it runs, fails, and is dropped
from the artifact. `scripts/hooks/tests/test_lint_all.py` fails on either.

It is not cosmetic in the other direction either. Node 22+ ships an experimental built-in
`localStorage` global that evaluates to `undefined` unless `--localstorage-file` is passed,
and under vitest's `globals: true` that shadows happy-dom's. A workstation on v26 failed 46
frontend tests across 7 files while the same suite was green on CI's Node 20 — and the stop
gate then blocked every session on failures no branch had caused. The repair is
`frontend/src/tests/setup/webStorage.ts`, and now that CI is past 22.4 itself, it is
load-bearing there too rather than a courtesy to workstations.

`logs/` holds per-run failure artifacts, and `scripts/prune-logs.py` bounds its growth
from the SessionStart hook. The current artifacts (`lint-errors.log`,
`test-failures.log`, ...) are protected from pruning at any age — the runners read a
missing artifact as "clean", so deleting one reports green having checked nothing.
Durable captures belong in `artifacts/`, local-only material in `.local/`.
