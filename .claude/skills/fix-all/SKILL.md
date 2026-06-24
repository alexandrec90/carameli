---
name: fix-all
disable-model-invocation: true
description: 'Coding-agent-driven loop: runs pytest then lint, delegates fixes to the per-check fixer skills, restarts the app so fixes take effect, and re-runs each check until green or a retry cap. Use to fix all outstanding failures in one supervised pass.'
---

# Skill: Fix All

> **Local session only.** This skill runs the check scripts (which need the Docker
> stack) and restarts containers between attempts. It cannot run in web or mobile
> sessions — see the Preflight for what to do there instead.

You — the coding agent in this session — **own this loop directly.** There is no
background script spawning another agent: you run each check with the shell, delegate
fixing to the per-check fixer skills with the Skill tool, make the fix live, and re-run.
The user watches it happen.

The fixers apply their **known-fixes short-circuit first** (cheap, no investigation) and
only reason from scratch on unmatched failures — that replaces the old cheap→full model
escalation, which only existed because a script picked the model per call.

---

## Preflight — the stack must be live (do this first)

This loop runs the check scripts and restarts containers, so it needs a running Docker
stack. **Before running any check or editing any file:**

1. Confirm the stack is up — `docker compose ps`. The `app` and `db` containers must be running.
2. **Stack down** (Docker is running but the containers aren't) → **stop immediately.** Do
   not run a check or edit anything. Bring the stack up (`docker compose up -d`), then re-invoke.
3. **No Docker at all** (web / mobile / CI session — no daemon) → this live
   loop can't run here, so **don't attempt it.** The mobile/CI flow is different: run the
   per-check fixers `/fix-tests`, `/fix-lint` against the logs CI produced
   (open the On-Demand workflow's PR), then push and let the workflow re-run. `fix-all`'s
   value is the *local* live re-run loop; on mobile that role belongs to CI, not this skill.

## Branch safety

If the working branch is the default branch (`master`), create an `auto-fix/<timestamp>`
branch before any edits, so the auto-fix pass is isolated. On a feature branch, stay on it.

---

## The loop

Run the two checks **in order** — pytest, then lint. Tests do the substantive code edits;
lint runs last so its auto-fixers (`ruff --fix`, `ruff format`, `eslint --fix`, …) format
whatever the test fixes just changed — no separate re-lint pass needed. For each check:

| Check | Run (writes its log) | Log artifact | Fixer |
|---|---|---|---|
| pytest | run the test suite | `logs/test-failures.log` | `/fix-tests` |
| Lint | run the lint suite | `logs/lint-errors.log` | `/fix-lint` |

For each check, up to **3 attempts**:

1. **Run the check.** Don't ingest its streamed stdout — discard it and read the capped
   log artifact instead (a green run leaves the log empty). For pytest, run the **full**
   suite on the first attempt only; on every re-run use the **changed-only (testmon)** run —
   it reruns just the tests your edits touched, and falls back to the full xdist run on its
   own if testmon selects more than half the suite.
2. **Passed?** (exit 0 / empty log) → move to the next check.
3. **Failed?** Invoke the matching fixer with the Skill tool, exactly as if the user typed
   the slash command. The fixer handles its own log + known-fixes short-circuit.
4. **Make the fix live** (pytest only — lint needs no restart):
   - `app/` files changed → restart the app container (`docker compose restart app`).
   - `requirements.txt` changed → `docker compose build app`, then restart.
   - A new `alembic/versions/*.py` migration appeared → apply it
     (`docker compose exec -T app alembic upgrade head`).
   - Then check stack health (`docker compose ps`); if a container shows
     Unhealthy/Exited/Restarting, invoke `/fix-docker` before re-running.
5. **Re-run** (back to step 1). After 3 failed attempts, stop on this check, note it, and
   move to the next — never loop forever.

---

## Report

After both checks, summarize:

- Per check: passed clean / passed after N attempts / still failing after 3.
- Which files changed, and any container ops triggered (restart / rebuild / migrate / fix-docker).
- Any unmatched failures still in the trimmed logs.
- Whether you're on an `auto-fix/*` branch the user needs to review and merge.

---

## Hard Rules

1. **Preflight first.** Never run a check or edit a file unless the Docker stack is live.
   No Docker (mobile/web/CI) → don't run the loop; use the CI path in the Preflight.
2. **Never spawn a coding-agent CLI** (`claude`/`copilot`/`codex`). You are the agent —
   delegate fixes with the Skill tool, run checks with the shell. Nothing in this loop
   shells out to another agent.
3. **Run sequentially** — pytest, then lint. Edits from the test pass feed the lint pass.
4. **Restart the app after `app/` edits** before re-running pytest. A stale container
   produces false failures.
5. **Cap at 3 attempts per check**, then move on. Report the holdout; don't spin.
6. **Delegate all fixing** to the sub-skills — this skill orchestrates, it doesn't edit
   source directly.
7. **Don't pipe streamed check output into context** — read the capped `logs/*.log`
   artifact each check produces.
