---
name: fix-docker
description: 'Fixes Docker stack failures from logs/docker/ artifacts. Use when the Docker stack fails to start, a container is unhealthy, or the build/migrate step errors.'
argument-hint: '(no arguments)'
---

# Skill: Fix Docker Errors

Fix Docker failures collected in `logs/docker/` artifact files.

---

## Step 1 — Collect Errors

Read all non-empty files in `logs/docker/` with the Read tool:

| Artifact | Written by | Contains |
|---|---|---|
| `logs/docker/health.log` | Docker: Stack Status | Container status, sick-container logs, healthcheck details |
| `logs/docker/config.log` | Docker: Stack Status | Compose config validation, Docker resource usage |
| `logs/docker/app-logs.log` | Docker: Stack Status | Recent app container log lines (always collected) |
| `logs/docker/build.log` | Start: Full Stack | Build output, startup failures |
| `logs/docker/migrate.log` | DB: Apply Migrations | Alembic migration output |
| `logs/docker/restart.log` | Restart: App Container | Restart failures |
| `logs/docker/down.log` | Stop: Docker Stack | Shutdown failures |
| `logs/docker/prune.log` | Docker: Prune + Compact | Prune/compact failures |

If the `logs/docker/` directory does not exist or all files are empty, tell the user to run
the `Docker: Stack Status` task first, then stop.

### Addressed-artifact check

After fixing errors from an artifact (Step 2), you will append an `--- ADDRESSED` marker
to that file (see Step 2). On subsequent runs, **skip** any artifact whose last line is
`--- ADDRESSED` — those errors have already been fixed and the file has not been
refreshed by a task since.

Task scripts overwrite the entire file on each run, so the marker is naturally cleared
whenever the user re-runs the producing task (e.g., `Docker: Stack Status`).

### Log quality gate

Before building the triage table, check each non-empty artifact for these signals of
incomplete diagnostics:

| Signal | What it means |
|---|---|
| `health.log` is non-empty but has no container name, status, or service output | Docker status capture failed — the script got no usable output |
| `app-logs.log` is empty or absent when `health.log` shows an unhealthy container | App log capture was skipped or failed |
| An artifact contains only `Cannot connect to the Docker daemon` or `is the docker daemon running` | Docker is unreachable — infra issue, not a code fix |

If **any** quality problem is found:

- **Docker unreachable** (`Cannot connect`, `is the docker daemon running`): tell the user
  to start Docker Desktop and re-run **Docker: Stack Status**, then **stop**.
- **Empty capture when Docker is reachable**: update `scripts/docker-status.ps1` to fix the
  capture logic (e.g., ensure `docker compose ps` output is written, ensure app logs are
  collected for unhealthy containers), then ask the user to re-run **Docker: Stack Status**
  and **stop**.

### Triage table

Build a triage table from all non-empty, **non-addressed** artifacts:

| # | Source file | Status | Service | Root cause summary | Action |
|---|---|---|---|---|---|

Classify each entry as:

- **config issue** — missing/invalid env var, bad port binding, missing `.env` file, invalid compose YAML
- **build failure** — Dockerfile error, missing dependency, syntax error in app code
- **dependency issue** — a service this one depends on is unhealthy or not started
- **migration failure** — Alembic schema error, missing migration, model drift
- **resource issue** — disk full, too many dangling images
- **transient failure** — image pull timeout, Docker daemon issue

---

## Step 2 — Apply Fixes

Skip **addressed** artifacts (last line is `--- ADDRESSED`). For each remaining failure:

1. Identify the root cause from the captured logs.
2. If it is a **dependency chain** issue (service stuck in "Created" because an upstream
   service is unhealthy), fix the upstream service first.
3. For **config issues**: check `.env.example` for the expected variable and fix `.env`
   or `docker-compose.yml` as needed.
4. For **build failures**: open the implicated source file and apply the smallest fix.
5. For **migration failures**: check `alembic/versions/` and models for drift.
6. For **resource issues**: suggest running the `Docker: Prune + Compact VHDX` task.
7. For **transient failures**: note them and skip — these resolve on retry.

**Stop conditions:**

- The fix requires changing infrastructure (new Docker image, new service) — describe
  what is needed and ask for confirmation.
- Required context is missing (e.g., missing credentials) — ask a single clarifying
  question and stop.

**After fixing** all actionable errors from an artifact, append the line
`--- ADDRESSED` to the end of that file using the Edit tool. This prevents the
same errors from being re-triaged on the next `/fix-docker` invocation. (The marker
is cleared automatically when the producing task overwrites the file.)

If an artifact contains **only transient failures** (no code fix applied), do **not**
stamp it — transient errors should be re-evaluated on the next run.

**Important:** Never run `docker` or `docker compose` commands directly — provide
commands for the user to run instead.

---

## Step 3 — Verify

Provide the user with the **fastest** command to apply the fix, then tell them to run
`Docker: Stack Status` afterwards.

### Choosing the right apply command

All apply commands are run as a single PowerShell pipeline that tees output to the matching
`logs/docker/` artifact file. This gives the user live terminal feedback **and** leaves a
machine-readable record for the next `/fix-docker` pass — without triggering a slow full
rebuild.

| What changed | Fastest apply command (with error capture) |
|---|---|
| Only `docker-compose.yml` env/config for **one** service | `docker compose up -d --no-build <service> 2>&1 \| Tee-Object -FilePath logs/docker/restart.log` |
| `docker-compose.yml` env/config for **multiple** services | `docker compose up -d --no-build 2>&1 \| Tee-Object -FilePath logs/docker/restart.log` |
| App source (`app/`) or `requirements*.txt` / `Dockerfile` | `docker compose up -d --build app 2>&1 \| Tee-Object -FilePath logs/docker/build.log` |
| Alembic migration only | Run the `DB: Apply Migrations` task (output already goes to `logs/docker/migrate.log`) |
| `docker-compose.yml` structural change (new service, volume, network) | `docker compose up -d --no-build 2>&1 \| Tee-Object -FilePath logs/docker/restart.log` |

Always prefer the single-service form (`--no-build <service>`) when only one container is
affected — it skips image pulls and build steps entirely and is the quickest path.

The `Tee-Object` pipeline **overwrites** the target file on each run (PowerShell default),
so any `--- ADDRESSED` stamp from a prior pass is cleared automatically — exactly the same
behaviour as the task scripts that produce the other artifacts.

After applying, tell the user to:

1. Run `Docker: Stack Status` to refresh the health/config/app-logs diagnostics.
2. Invoke `/fix-docker` again if any `logs/docker/` files still contain failures
   (including the freshly written `build.log` or `restart.log`).

Never run Docker commands directly from the agent — provide the commands for the user to run.

---

## Step 4 — Report

State clearly:

- Which artifacts had errors and from which task.
- Which artifacts were already addressed (skipped).
- Which errors were fixed (file, what changed).
- Which were skipped (transient / needs credentials / needs user action).
- Which artifacts were stamped `--- ADDRESSED`.
- Next step: which task(s) to re-run.

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. Never run `docker` or `docker compose` commands — provide them for the user to run.
3. One error = one minimal fix. Do not restructure surrounding code.
4. Never modify secrets or credentials in `.env` — report what is missing and let the user fill it in.
5. Skip artifacts already stamped `--- ADDRESSED` — they were fixed in a prior run.
6. Only stamp an artifact after applying at least one code fix from it (not for transient-only files).
7. **Log quality gate is mandatory.** Docker-unreachable errors are infra, not code — stop
   immediately and tell the user to start Docker Desktop. For empty captures when Docker is
   reachable, fix `scripts/docker-status.ps1` and stop.
