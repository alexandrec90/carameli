# Known Workflow-Run Fixes

Quick-lookup table for recurring GitHub Actions failure classes (Nightly, Weekly Hardening,
Sandbox Tests, On-Demand, master-dispatch PR Gate). When a failing job's signature matches a
pattern below, apply the documented action directly instead of investigating from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure/job pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-workflows skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| `Mutation testing report` (job) / `mutmut` / surviving mutants | The weekly `mutation` job is `continue-on-error: true` and always exits 0 — a low score is informational, not a failure | **Do not fix or open a PR.** Report the mutation score to the user and stop (Hard Rule 2). | 0 | — | 2026-07-14 |
| `Weekly reliability summary` (job) / `download-artifact` "Unable to find an artifact" | An upstream weekly job (migration/resilience/mutation) was skipped or failed, so its artifact is missing when the summary tries to download it | Fix the **upstream job** that failed to produce the artifact (Step 2). Don't fix the summary job itself. If the upstream job was legitimately skipped, make the summary's download step resilient in `weekly.yml` (`continue-on-error: true`) — a workflow edit, not a code fix (Hard Rule 3). | 0 | — | 2026-07-14 |
| `Cross-browser E2E` (job) / `playwright` browser `not found` / `Executable doesn't exist` | Playwright browser binaries missing in the runner (firefox/webkit) — an environment failure, not a code bug | `playwright install --with-deps` locally before reproducing; the workflow already runs it, so a persistent miss means the workflow step regressed — fix `nightly.yml`, not app code. | 0 | — | 2026-07-14 |
| `Migration round-trip + drift detection` (job) / models vs migrations drift / `alembic` autogenerate diff non-empty | A model change shipped without its migration; the weekly drift check diffs models against migrations and finds a delta | Generate the missing migration per `.claude/rules/migrations.md` (never hand-edit history); reproduce with `python scripts/run-tests.py`, then delegate to `/fix-tests`. | 0 | — | 2026-07-14 |
| `TELNYX_API_KEY is empty on the 'sandbox' environment` | The Sandbox Tests preflight step fails loudly when the `sandbox` GitHub environment has no credentials — an environment-setup gap, not a code bug | Set the secrets with `gh secret set TELNYX_API_KEY --env sandbox` (and the other `TELNYX_*` secrets / `TELNYX_WEBHOOK_BASE_URL` var listed in `sandbox-tests.yml`), then tell the user to re-dispatch — never auto-dispatch (Hard Rule 7). No source edit. | 0 | — | 2026-07-16 |
| `env file` + `.env not found` (a job running `docker compose up`) | `docker-compose.yml` marks `.env` as a required `env_file:` for the app/worker services; CI runners have no `.env` (gitignored) | Add `cp .env.example .env` before `docker compose up -d` in the workflow step — a workflow YAML fix, not app code. The step fails in seconds (before any health-check timeout), which is the tell. | 1 | 2026-07-17 | 2026-07-17 |
| `PermissionError` + `logs/runtime/carameli.log` (host pytest after `docker compose up`, exit code 4) | The compose containers run as root and create the bind-mounted `logs/` tree root-owned; host pytest then imports `app.main`, whose logging config opens the log for append and dies at collection | `sudo chown -R "$(id -u):$(id -g)" logs` in the workflow step after the compose health wait — workflow YAML fix, not app code (containers keep write access as root). | 1 | 2026-07-17 | 2026-07-17 |
