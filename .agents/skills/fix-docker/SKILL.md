---
name: fix-docker
# No disable-model-invocation: this skill is invoked programmatically by /fix-all and
# /fix-tests via the Skill tool. See .claude/rules/authoring.md (orchestrated sub-skill exception).
description: 'Fixes Docker stack failures from logs/docker/ artifacts. Use when the Docker stack fails to start, a container is unhealthy, or the build/migrate step errors.'
argument-hint: '(no arguments)'
---

# Skill: Fix Docker Errors

> Depends on the local Docker stack and its diagnostics being available.

Fix Docker failures collected in `logs/docker/` artifact files.

---

## Step 1 — Collect Errors

Read all non-empty files in `logs/docker/` with the Read tool:

| Artifact | Produced by | Contains |
|---|---|---|
| `logs/docker/health.log` | the stack status check | Container status, sick-container logs, healthcheck details |
| `logs/docker/config.log` | the stack status check | Compose config validation, Docker resource usage |
| `logs/docker/app-logs.log` | the stack status check | Recent app container log lines (always collected) |
| `logs/docker/build.log` | stack startup / build | Build output, startup failures |
| `logs/docker/migrate.log` | applying migrations | Alembic migration output |
| `logs/docker/restart.log` | restarting the app | Restart failures |
| `logs/docker/down.log` | stopping the stack | Shutdown failures |
| `logs/docker/prune.log` | prune / compact | Prune/compact failures |

If the `logs/docker/` directory does not exist or all files are empty, regenerate them by
running the stack status check — `python scripts/docker-status.py` (named on each artifact's
`# source:` header) — yourself. If Docker is unreachable, say so and stop.

### Addressed-artifact check

After fixing errors from an artifact (Step 2), you will append an `--- ADDRESSED` marker
to that file (see Step 2). On subsequent runs, **skip** any artifact whose last line is
`--- ADDRESSED` — those errors have already been fixed and the file has not been
refreshed by a task since.

The producing check overwrites the entire file on each run, so the marker is naturally cleared
whenever the stack status check is re-run.

### Log quality gate

Before building the triage table, check each non-empty artifact for these signals of
incomplete diagnostics:

| Signal | What it means |
|---|---|
| `health.log` is non-empty but has no container name, status, or service output | Docker status capture failed — the script got no usable output |
| `app-logs.log` is empty or absent when `health.log` shows an unhealthy container | App log capture was skipped or failed |
| An artifact contains only `Cannot connect to the Docker daemon` or `is the docker daemon running` | Docker is unreachable — infra issue, not a code fix |
| Healthy-container logs or unrelated-service chatter bury the one unhealthy container | Noise — the status check dumped too much; the actionable failure is unfindable |

If **any** quality problem is found:

- **Docker unreachable** (`Cannot connect`, `is the docker daemon running`): this needs Docker
  Desktop running — say so and **stop**.
- **Empty capture when Docker is reachable**: update the producing status check to fix the
  capture logic (e.g., ensure `docker compose ps` output is written, ensure app logs are
  collected for unhealthy containers), then regenerate the diagnostics and **stop**.
- **Noise burying the signal**: update the producing status check to scope captured logs to the
  sick container(s) and drop healthy-service chatter, then regenerate and **stop**. Don't wade
  through the noise to fix by hand.

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
6. For **resource issues**: suggest a prune + VHDX-compaction pass to reclaim space.
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

**Important:** Diagnose from the `logs/docker/` artifacts, not raw `docker` output. After applying
a fix you may run the targeted apply command (the single-service `--no-build`/`--build` form below)
and re-run the stack status check to confirm the container comes up healthy. Avoid destructive ops
(`down -v`, full-stack restarts) — confirm with the user before those.

---

## Step 3 — Verify

Apply the **fastest** targeted command, capturing its output to the matching `logs/docker/`
artifact, then re-run the stack status check afterwards.

### Choosing the right apply command

Run the smallest targeted command and redirect its output to the matching `logs/docker/`
artifact file — that leaves a machine-readable record for the next `/fix-docker` pass without
triggering a slow full rebuild.

| What changed | Fastest apply command |
|---|---|
| Only `docker-compose.yml` env/config for **one** service | `docker compose up -d --no-build <service>` → `logs/docker/restart.log` |
| `docker-compose.yml` env/config for **multiple** services | `docker compose up -d --no-build` → `logs/docker/restart.log` |
| App source (`app/`) or `requirements*.txt` / `Dockerfile` | `docker compose up -d --build app` → `logs/docker/build.log` |
| Alembic migration only | `docker compose exec -T app alembic upgrade head` → `logs/docker/migrate.log` |
| `docker-compose.yml` structural change (new service, volume, network) | `docker compose up -d --no-build` → `logs/docker/restart.log` |

Redirect each command's combined output (`2>&1`) to the listed artifact, **overwriting** it
so any `--- ADDRESSED` stamp from a prior pass is cleared automatically. Always prefer the
single-service form (`--no-build <service>`) when only one container is affected — it skips
image pulls and build steps entirely and is the quickest path.

After applying, **loop to green yourself** — don't hand a half-fixed stack back:

1. Re-run the stack status check to refresh the health/config/app-logs diagnostics
   (including the freshly written `build.log` / `restart.log`).
2. If any `logs/docker/` artifact still shows failures, fix and re-verify again — up to
   **4 rounds**, stopping early if a round ends with the **same failures** it began with
   (report the stuck failures rather than spinning). Transient failures (image-pull
   timeouts, daemon blips) don't block "green" — note and skip them.

You may run the targeted single-service apply command yourself to verify the fix. Avoid destructive
or full-stack commands (`down -v`, full restarts) — provide those for the user to run.

---

## Step 4 — Report

State clearly:

- Which artifacts had errors and from which task.
- Which artifacts were already addressed (skipped).
- Which errors were fixed (file, what changed).
- Which were skipped (transient / needs credentials / needs user action).
- Which artifacts were stamped `--- ADDRESSED`.
- Next step: which diagnostics to regenerate.

---

## Hard Rules

1. Edit only files directly implicated by the collected errors — never pre-emptive cleanup.
2. Run only targeted apply/verify commands (single-service `up`/`build`, the stack status check).
   Avoid destructive ops (`down -v`, full-stack restart) — provide those for the user to run.
3. One error = one minimal fix. Do not restructure surrounding code.
4. Never modify secrets or credentials in `.env` — report what is missing and let the user fill it in.
5. Skip artifacts already stamped `--- ADDRESSED` — they were fixed in a prior run.
6. Only stamp an artifact after applying at least one code fix from it (not for transient-only files).
7. **Log quality gate is mandatory (both directions).** Docker-unreachable errors are infra,
   not code — stop immediately and say Docker Desktop needs to be running. For empty captures
   *or* noise that buries the failing container when Docker is reachable, fix the producing
   status check (and its test) and stop — never fix by hand from a suboptimal artifact.
