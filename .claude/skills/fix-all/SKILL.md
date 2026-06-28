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
background script spawning another agent: you run each check with the shell, fix by
**reading the per-check fixer's `SKILL.md` and following it**, make the fix live, and re-run.

> **The fixers can't be invoked with the Skill tool** — `fix-lint` and `fix-tests` are
> `disable-model-invocation: true`, so a model-initiated Skill call is rejected
> (`cannot be used with Skill tool due to disable-model-invocation`). Delegation here means
> **Read the fixer's `SKILL.md` file and execute its steps yourself**, in full. Read the
> file (e.g. `.claude/skills/fix-tests/SKILL.md`), never the directory.

Following the fixer faithfully matters: it applies its **known-fixes short-circuit first**
(cheap, no investigation) and only reasons from scratch on unmatched failures. Skipping it
and freelancing the fixes is what causes investigation spirals.

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
3. **Failed?** Read the matching fixer's `SKILL.md` — `.claude/skills/fix-tests/SKILL.md`
   (pytest) or `.claude/skills/fix-lint/SKILL.md` (lint) — and follow it in full, treating
   the environment as `desktop` so it doesn't re-probe Docker. (Don't use the Skill tool —
   the fixers are `disable-model-invocation`; Read and execute the file directly.)
4. **Make the fix live** (pytest only — lint needs no restart):
   - `app/` files changed → `docker compose restart app`.
   - `requirements.txt` changed → `docker compose build app`, then restart.
   - New `alembic/versions/*.py` migration → `docker compose exec -T app alembic upgrade head`.
   - Check stack health (`docker compose ps`); if a container is Unhealthy/Exited/Restarting, Read `.claude/skills/fix-docker/SKILL.md` and follow it before re-running (same as the other fixers — not the Skill tool).
5. **Re-run** (back to step 1). After 3 failed attempts, stop, note it, and move to the next check — never loop forever.

---

## CI path (no Docker — mobile/web)

The On-Demand Lint + Test workflow (`.github/workflows/on-demand.yml`) commits the
filtered log artifacts (`logs/lint-errors.log`, `logs/test-failures.log`) to a
`fix/auto-<timestamp>` branch and opens a PR. Each `/fix-all` invocation does **one**
round — discover the fix branch, fix against its committed logs, push — then **stops**.
Pushing re-triggers CI automatically; re-invoke `/fix-all` once that run completes to do
the next round (or confirm green).

> **Never wait for CI in-context.** Standalone `sleep` is blocked by the harness
> (`Blocked: standalone sleep 30 ...`), so a poll-every-30s loop degenerates into
> unthrottled back-to-back `mcp__github__actions_list` calls that re-inject the whole
> conversation each time and burn the token budget. Do not poll-wait: trigger or push,
> report, and stop. The user (or a `/loop`) re-invokes when CI is done.

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
| `status: in_progress` or `queued` | A run is already going — report its URL and tell the user to re-invoke `/fix-all` once it completes. **Stop** (don't wait in-context). |
| `conclusion: success` and no fix branch | CI ran clean — no failures. Stop and report. |
| `conclusion: failure` or `conclusion: cancelled` | The workflow itself crashed (setup, migrations, etc.). Report the run URL and tell the user to check the Actions log. Stop. |
| No runs at all, or latest run was `success` with a fix branch (stale) | Trigger a fresh run (below). |

**To trigger a fresh run**, call `mcp__github__actions_run_trigger` (owner
`alexandrec90`, repo `carameli`, workflow_id `on-demand.yml`, ref `master`). Then **report
the triggered run's URL and stop** — tell the user to re-invoke `/fix-all` once it
completes, when its committed logs will be on a fresh `fix/auto-*` branch. Do not wait
in-context for it to finish.

### Step 2 — Check out the fix branch

```sh
git fetch origin <branch>
git checkout <branch>
```

The committed `logs/lint-errors.log` and `logs/test-failures.log` are now on disk —
**do not overwrite them**; they are the CI-produced artifacts the fixers read.

### Step 3 — Fix

Fix by **reading the fixer's `SKILL.md` and following it** (the Skill tool can't invoke them
— they're `disable-model-invocation`). Read the file, not the directory, and treat the
environment as `mobile` so the fixer doesn't re-probe Docker.

- If `logs/lint-errors.log` is non-empty → Read `.claude/skills/fix-lint/SKILL.md` and follow it in full.
- If `logs/test-failures.log` is non-empty → Read `.claude/skills/fix-tests/SKILL.md` and follow it in full.
- If `logs/frontend-test-failures.log` is non-empty → **do not attempt it.** Vitest can't run
  on a cloud/mobile session, so these failures can't be verified here. Record them for the
  report as needing a local session — do not edit toward them and do not let them drive a round.
- If `logs/lint-errors.log` and `logs/test-failures.log` are both empty → the fixable scope is
  green. Stop and report (noting any frontend failures left for a local session).

### Step 4 — Push and stop

Commit all file edits and push to the same `fix/auto-*` branch:

```sh
git push -u origin <branch>
```

The On-Demand workflow's `push` trigger on `fix/auto-**` branches fires CI automatically —
no manual dispatch needed. **Then stop.** Report the PR URL, what you fixed, and that CI is
re-running. Do **not** poll-wait for the re-run (see the no-in-context-wait note above).

This invocation's round is done. To continue, re-invoke `/fix-all mobile` once the push-
triggered run completes: it checks out the branch, reads the refreshed logs, and either
fixes the next batch or confirms green (both `logs/lint-errors.log` and
`logs/test-failures.log` empty). To automate the re-invocation, wrap it in `/loop`. A
non-empty `logs/frontend-test-failures.log` is reported for a local session, never a round.

---

## Report

After completing either path, summarize:

- Which path was used (local loop vs CI).
- Per check: passed clean / passed after N attempts / still failing after 3 (local), or fixed and pushed for CI to re-run (mobile — one round per invocation; say to re-invoke `/fix-all` once CI completes).
- Which files changed, and any container ops triggered (local: restart / rebuild / migrate / fix-docker).
- Any unmatched failures still in the trimmed logs.
- Local only: whether you're on an `auto-fix/*` branch the user needs to review and merge.
- Mobile only: the PR URL and that CI is re-running, plus any `logs/frontend-test-failures.log`
  failures left untouched for a local session (state that vitest can't run on a cloud session).

---

## Hard Rules

1. **Honor the env argument; else check Docker first.** If `desktop`/`mobile` was passed, take that path. Otherwise use `docker info` — never infer the path from the branch name.
2. **Local — stack must be live before any check or file edit.** If the stack is down, bring it up first.
3. **Mobile — never skip to fixing without checking out the fix branch first.** The log
   artifacts live on that branch; fixing against stale or absent local logs produces wrong fixes.
   Trigger CI yourself if no fix branch exists — do not ask the user to do it.
4. **Never spawn a coding-agent CLI** (`claude`/`copilot`/`codex`). You are the agent —
   fix by reading the fixer's `SKILL.md` and following it, run checks with the shell.
5. **Run checks sequentially** — pytest, then lint. Edits from the test pass feed the lint pass.
6. **Local — restart the app after `app/` edits** before re-running pytest.
7. **Cap at 3 attempts per check** (local), then move on. Report the holdout; don't spin.
8. **Delegate all fixing by reading and following the sub-skill `SKILL.md`** — never the Skill
   tool (the fixers are `disable-model-invocation`; it rejects them, and freelancing the fix
   instead of following the file is what spirals). This skill orchestrates; the fixer files own the edits.
9. **Don't pipe streamed check output into context** — read the capped `logs/*.log` artifact each check produces.
10. **Mobile — never attempt `logs/frontend-test-failures.log`.** Vitest can't run on a cloud
    session, so a fix can't be verified and any attempt just spirals. Report those failures as
    needing a local session; they never count toward the green check or trigger another round.
11. **Mobile — never wait for CI in-context.** Standalone `sleep` is blocked, so a poll loop
    becomes unthrottled `actions_list` calls that burn the budget. One round per invocation:
    trigger or push, report, **stop**. Re-invoking `/fix-all` (or a `/loop`) continues the loop.
