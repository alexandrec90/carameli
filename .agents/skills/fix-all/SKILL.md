---
name: fix-all
disable-model-invocation: true
argument-hint: 'Optional: "desktop" | "mobile" to skip env detection (else auto-detects via docker info)'
description: 'Coding-agent-driven loop: runs pytest then lint, delegates fixes to the per-check fixer skills, and re-runs each check until green or a retry cap. Local sessions use a live Docker re-run loop; mobile/web sessions discover the latest On-Demand CI run, check out its fix branch, fix against the committed logs, and push to re-trigger CI.'
---

# Skill: Fix All

Accepts an optional environment argument: `desktop` or `mobile`. When given, skip the Docker check and take the matching path directly. When omitted, run `docker info` to decide.

Two paths — pick by the argument if given, else check Docker:

- **`desktop` / Docker available** → [Local path](#local-path-docker-available): live re-run loop inside the running stack.
- **`mobile` / no Docker** → [CI path](#ci-path-no-docker--mobileweb): discover the latest On-Demand PR, check out its branch, fix against its committed logs, push to re-trigger CI.

Never infer the path from the branch name.

---

## Local path (Docker available)

You — the coding agent in this session — **own this loop directly.** There is no
background script spawning another agent: you run each check with the shell, delegate
fixing to the per-check fixer skills with the Skill tool, make the fix live, and re-run.

The fixers apply their **known-fixes short-circuit first** (cheap, no investigation) and
only reason from scratch on unmatched failures.

### Stack health check

Before running any check or editing any file:

1. Confirm the stack is up — `docker compose ps`. The `app` and `db` containers must be running.
2. **Stack down** → do not run a check or edit anything. Bring the stack up
   (`docker compose up -d`), then re-invoke.

### Branch safety

If the working branch is the default branch (`master`), create an `auto-fix/<timestamp>`
branch before any edits. On a feature branch, stay on it.

### The loop

Run the two checks **in order** — pytest, then lint. Tests do the substantive code edits;
lint runs last so its auto-fixers format whatever the test fixes just changed.

| Check | Run (writes its log) | Log artifact | Fixer |
|---|---|---|---|
| pytest | run the test suite | `logs/test-failures.log` | `/fix-tests` |
| Lint | run the lint suite | `logs/lint-errors.log` | `/fix-lint` |

> **Scope: pytest + lint only.** Does **not** cover `frontend-tests`, `hook-tests`, or
> `telnyx-sandbox`. For a multi-section log, run `/fix-tests` directly (it regenerates
> with `--all`) instead of `/fix-all`.

For each check, up to **3 attempts**:

1. **Run the check.** Discard streamed stdout — read the capped log artifact instead
   (a green run leaves the log empty). For pytest, run the **full** suite on the first
   attempt; on re-runs use the **changed-only (testmon)** run.
2. **Passed?** (exit 0 / empty log) → move to the next check.
3. **Failed?** Invoke the matching fixer with the Skill tool, forwarding the resolved
   environment as its argument (`desktop` here) so it doesn't re-probe Docker.
4. **Make the fix live** (pytest only — lint needs no restart):
   - `app/` files changed → `docker compose restart app`.
   - `requirements.txt` changed → `docker compose build app`, then restart.
   - New `alembic/versions/*.py` migration → `docker compose exec -T app alembic upgrade head`.
   - Check stack health (`docker compose ps`); if a container is Unhealthy/Exited/Restarting, invoke `/fix-docker` before re-running.
5. **Re-run** (back to step 1). After 3 failed attempts, stop, note it, and move to the next check — never loop forever.

---

## CI path (no Docker — mobile/web)

The On-Demand Lint + Test workflow (`.github/workflows/on-demand.yml`) commits the
filtered log artifacts (`logs/lint-errors.log`, `logs/test-failures.log`) to a
`fix/auto-<timestamp>` branch and opens a PR. This path is a **self-contained loop**:
trigger CI if needed, wait, fix, push, wait for the re-run, and repeat until green —
up to 3 fix rounds without any human intervention.

### Step 1 — Discover or trigger CI

Call `mcp__github__list_pull_requests` (owner `alexandrec90`, repo `carameli`,
state `all`, sort `created`, direction `desc`) and scan for the most-recent PR whose
title starts with `fix: on-demand lint+test`. Prefer open over closed.

**If a matching PR exists** → note the branch name and go to Step 2.

**If no matching PR exists**, call `mcp__github__actions_list` (method
`list_workflow_runs`, owner `alexandrec90`, repo `carameli`,
resource_id `on-demand.yml`) to check the latest run:

| Latest run state | Action |
|---|---|
| `status: in_progress` or `queued` | A run is already in progress — skip triggering and go straight to **Wait** below. |
| `conclusion: success` and no fix branch | CI ran clean — no failures. Stop and report. |
| `conclusion: failure` or `conclusion: cancelled` | The workflow itself crashed (setup, migrations, etc.). Report the run URL and tell the user to check the Actions log. Stop. |
| No runs at all, or latest run was `success` with a fix branch (stale) | Trigger a fresh run. |

**To trigger a fresh run**, call `mcp__github__actions_run_trigger` (owner
`alexandrec90`, repo `carameli`, workflow_id `on-demand.yml`, ref `master`).

**Wait for the run to complete**: after triggering (or if a run was already in
progress), poll `mcp__github__actions_list` every 30 seconds (`Bash sleep 30` between
calls) until the most-recent run's `status` is `completed`. Cap at 20 polls (~10 min).
If the cap is hit, report the timeout and the in-progress run URL, then stop.
Once `completed`:
- `conclusion: success` + no fix branch created → clean, stop and report.
- `conclusion: failure` / `cancelled` → report the run URL, stop.
- A new `fix/auto-*` PR now exists → go to Step 2.

### Step 2 — Check out the fix branch

```sh
git fetch origin <branch>
git checkout <branch>
```

The committed `logs/lint-errors.log` and `logs/test-failures.log` are now on disk —
**do not overwrite them**; they are the CI-produced artifacts the fixers read.

### Step 3 — Fix

Forward the resolved environment (`mobile` here) as the fixer's argument so it doesn't re-probe.

- If `logs/lint-errors.log` is non-empty → invoke `/fix-lint mobile` with the Skill tool.
- If `logs/test-failures.log` is non-empty → invoke `/fix-tests mobile` with the Skill tool.
- If both are empty → CI is already green. Stop and report.

### Step 4 — Push and wait for re-run

Commit all file edits and push to the same `fix/auto-*` branch:

```sh
git push -u origin <branch>
```

Note the push timestamp. The On-Demand workflow's `push` trigger on `fix/auto-**`
branches fires CI automatically — no manual dispatch needed.

**Wait for the re-run**: poll `mcp__github__actions_list` every 30 seconds until you
see a run on the `fix/auto-*` branch with `event: push` and `status: completed` that
started after your push timestamp. Cap at 20 polls (~10 min).

Once completed:
- `conclusion: success` → pull the updated logs (`git pull`). If both logs are empty,
  the branch is green — stop and report. If logs are non-empty (CI found new failures),
  go back to Step 3 for another round.
- `conclusion: failure` / `cancelled` → report the run URL and stop.

**Cap: 3 fix rounds total** (Steps 3→4 counted together). After 3 rounds with failures
still present, stop and report what remains.

---

## Report

After completing either path, summarize:

- Which path was used (local loop vs CI).
- Per check: passed clean / passed after N attempts / still failing after 3 (local), or fixed and pushed to CI (mobile).
- Which files changed, and any container ops triggered (local: restart / rebuild / migrate / fix-docker).
- Any unmatched failures still in the trimmed logs.
- Local only: whether you're on an `auto-fix/*` branch the user needs to review and merge.
- Mobile only: the PR URL and that CI is re-running.

---

## Hard Rules

1. **Honor the env argument; else check Docker first.** If `desktop`/`mobile` was passed, take that path. Otherwise use `docker info` — never infer the path from the branch name.
2. **Local — stack must be live before any check or file edit.** If the stack is down, bring it up first.
3. **Mobile — never skip to fixing without checking out the fix branch first.** The log
   artifacts live on that branch; fixing against stale or absent local logs produces wrong fixes.
   Trigger CI yourself if no fix branch exists — do not ask the user to do it.
4. **Never spawn a coding-agent CLI** (`claude`/`copilot`/`codex`). You are the agent —
   delegate fixes with the Skill tool, run checks with the shell.
5. **Run checks sequentially** — pytest, then lint. Edits from the test pass feed the lint pass.
6. **Local — restart the app after `app/` edits** before re-running pytest.
7. **Cap at 3 attempts per check** (local), then move on. Report the holdout; don't spin.
8. **Delegate all fixing** to the sub-skills — this skill orchestrates, it doesn't edit source directly.
9. **Don't pipe streamed check output into context** — read the capped `logs/*.log` artifact each check produces.
