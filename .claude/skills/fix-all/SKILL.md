---
name: fix-all
disable-model-invocation: true
description: 'Coding-agent-driven loop: runs pytest then lint, delegates fixes to the per-check fixer skills, and re-runs each check until green or a retry cap. Local sessions use a live Docker re-run loop; mobile/web sessions discover the latest On-Demand CI run, check out its fix branch, fix against the committed logs, and push to re-trigger CI.'
---

# Skill: Fix All

Two paths — check Docker first, then follow the matching one:

- **Docker available** → [Local path](#local-path-docker-available): live re-run loop inside the running stack.
- **No Docker** → [CI path](#ci-path-no-docker--mobileweb): discover the latest On-Demand PR, check out its branch, fix against its committed logs, push to re-trigger CI.

Check Docker with `docker info`. Never infer the path from the branch name.

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
3. **Failed?** Invoke the matching fixer with the Skill tool.
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
`fix/auto-<timestamp>` branch and opens a PR. Fix against those logs, push back to the
same branch, and CI re-runs automatically.

### Step 1 — Discover the latest fix branch

Call `mcp__github__list_pull_requests` (repo `alexandrec90/carameli`, state `all`,
sort `created`, direction `desc`) and scan the results for PRs whose title starts with
`fix: on-demand lint+test` (the On-Demand workflow's PR title pattern). Take the
most-recent one. Prefer open over closed; a closed branch still carries the committed
logs and accepts new pushes.

**If no matching PR is found**, call `mcp__github__actions_list` with
`method: list_workflow_runs`, `owner: alexandrec90`, `repo: carameli`,
`resource_id: on-demand.yml` to check the latest run:

| Latest run state | Action |
|---|---|
| `conclusion: success` and no fix branch | CI ran clean — no failures, no auto-fixes needed. Stop and report. |
| `status: in_progress` or `queued` | The workflow is still running. Tell the user to re-invoke `/fix-all` once it completes. |
| `conclusion: failure` or `conclusion: cancelled` | The workflow itself crashed (setup, migrations, etc.) — not a code failure. Report the run URL and tell the user to check the Actions log. |
| No runs at all | Inform the user: trigger the **On-Demand Lint + Test** workflow from the GitHub Actions tab (workflow_dispatch), then re-invoke once it completes. |

### Step 2 — Check out the fix branch

```sh
git fetch origin <branch>
git checkout <branch>
```

The committed `logs/lint-errors.log` and `logs/test-failures.log` are now on disk —
**do not overwrite them**; they are the CI-produced artifacts the fixers read.

### Step 3 — Fix

- If `logs/lint-errors.log` is non-empty → invoke `/fix-lint` with the Skill tool.
- If `logs/test-failures.log` is non-empty → invoke `/fix-tests` with the Skill tool.
- If both are empty → CI is already green. Stop and report.

### Step 4 — Push and re-trigger CI

Commit all file edits and push to the same `fix/auto-*` branch:

```sh
git push -u origin <branch>
```

The On-Demand workflow's `push` trigger on `fix/auto-**` branches fires CI
automatically — it rebuilds, reruns both checks, and updates the PR's committed
artifacts in place. No new PR is created; no manual workflow dispatch needed.

After pushing, report what was fixed and that CI is re-running. If the user wants to
iterate, they can re-invoke `/fix-all` once the new CI run completes and its fresh logs
are committed to the branch.

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

1. **Check Docker first.** Use `docker info` — never infer the path from the branch name.
2. **Local — stack must be live before any check or file edit.** If the stack is down, bring it up first.
3. **Mobile — never skip to fixing without checking out the fix branch first.** The log
   artifacts live on that branch; fixing against stale or absent local logs produces wrong fixes.
4. **Never spawn a coding-agent CLI** (`claude`/`copilot`/`codex`). You are the agent —
   delegate fixes with the Skill tool, run checks with the shell.
5. **Run checks sequentially** — pytest, then lint. Edits from the test pass feed the lint pass.
6. **Local — restart the app after `app/` edits** before re-running pytest.
7. **Cap at 3 attempts per check** (local), then move on. Report the holdout; don't spin.
8. **Delegate all fixing** to the sub-skills — this skill orchestrates, it doesn't edit source directly.
9. **Don't pipe streamed check output into context** — read the capped `logs/*.log` artifact each check produces.
