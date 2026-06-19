---
name: stack-review
disable-model-invocation: true
description: 'Audits the current tech stack and surfaces prioritized modernization recommendations. Use when evaluating dependencies, frameworks, or infrastructure for upgrades or replacements.'
argument-hint: 'Optional: "dismiss <id>" to remove a recommendation, "implement <id>" to action one, or "implement-all" to batch-implement all pending items via parallel agents'
---

# Skill: Stack Review

Periodically audit the project's dependencies and architecture against known
patterns. Surface prioritized, context-aware recommendations. Track them across
runs so nothing is re-recommended after it's been dismissed or implemented.

---

## Step 1 — Load State

Read `.claude/skills/stack-review/state.json`. It tracks recommendations across
runs. Each entry has:

```json
{
  "id": "redis",
  "title": "Add Redis",
  "priority": "high | medium | low",
  "status": "pending | implemented | dismissed",
  "added": "YYYY-MM-DD",
  "rationale": "One sentence why."
}
```

If the file does not exist yet, treat it as `{ "last_run": null, "recommendations": [] }`.

---

## Step 2 — Handle Argument

If an argument was passed:

- `dismiss <id>` — set that recommendation's status to `"dismissed"`, save state, report "Dismissed." Done.
- `implement <id>` — jump to Step 5 for that single item. Skip the audit.
- `implement-all` — jump to Step 5b. Skip the audit.
- No argument — continue to Step 3.

---

## Step 3 — Audit Project Files

Run the suggested preload command before auditing:

Read the following files using the Read tool (in parallel where independent):

- `requirements.txt`
- `docker-compose.yml`
- `CLAUDE.md`
- `todo.md`
- `frontend/package.json`
- Use Glob to discover: `alembic/versions/*.py` — count the results to get the migration revision count

Skip to Step 4 if Step 2 handled an argument (dismiss/implement — no audit needed).
Otherwise use the preloaded data. Reference:

| Section | What to look for |
| --- | --- |
| `requirements.txt` | Missing packages, known anti-patterns for async FastAPI |
| `docker-compose.yml` | Missing services (Redis, PgBouncer, observability stack) |
| `CLAUDE.md` | Current architecture — use as ground truth |
| `todo.md` | Items already tracked — do not duplicate them as recommendations |
| `frontend/package.json` | Outdated or missing frontend libraries |
| `alembic-count` | Migration revision count — flag if > 30 with no squash |

Cross-reference findings against the state file:

- Skip any recommendation whose `id` already exists with status `"implemented"` or `"dismissed"`.
- Update an existing `"pending"` entry's rationale if new information strengthens or weakens it.

---

## Step 4 — Output Report

Print a ranked table of new or updated `pending` recommendations:

```text
## Stack Review — YYYY-MM-DD

### High Priority
| # | ID | Recommendation | Rationale |
|---|---|---|---|
| 1 | redis | Add Redis | APScheduler job store + distributed lock for call deduplication |

### Medium Priority
...

### Low Priority
...

### Already Tracked / No Action Needed
List items already in todo.md or state as implemented/dismissed — one line each.
```

Then print a short "Next step" line for the top item only, e.g.:
> Next step: run `/stack-review implement redis` to add Redis to the project.

---

## Step 5 — Implement (if requested)

If running in implement mode for a specific `id`:

1. State the plan clearly before touching any files.
2. Make the changes — follow all project conventions from CLAUDE.md.
3. Update `todo.md` if this item appears there.
4. Set the recommendation status to `"implemented"` in state.json.
5. Summarize what was changed.

**Scope rules for implementation:**

- Add the service to `docker-compose.yml` and `requirements.txt` if applicable.
- Add config vars to `app/core/config.py` and document them in CLAUDE.md env table.
- Wire up a client/singleton in `app/core/` following the existing `database.py` pattern.
- Do not refactor unrelated code. One recommendation = one focused change set.

---

## Step 5b — Implement All (parallel waves)

This step is entered when `implement-all` is passed as the argument.

### 5b-1 — Collect pending items

Load all recommendations from state.json where `status == "pending"`. If none exist, print "Nothing pending." and stop.

### 5b-2 — Build a file-touch map

For each pending item, reason about which project files it will modify. Use these heuristics:

| Category | Files typically touched |
| --- | --- |
| Python dependency (linter, type checker, test lib) | `requirements.txt`, possibly `pyproject.toml` or a config file |
| Docker / infra | `docker-compose.yml` |
| Frontend dependency | `frontend/package.json`, `frontend/vite.config.ts` or similar |
| App core config | `app/core/config.py`, `.env.example`, `CLAUDE.md` |

Two items **conflict** if their file-touch sets share at least one file.

### 5b-3 — Devise wave plan

Greedily assign items to waves using a greedy graph-colouring approach:

- Wave 1: take as many non-conflicting items as possible.
- Wave 2: items that conflicted with Wave 1 but not each other.
- Continue until all items are assigned.

Print the wave plan **before touching any files**, in this format:

```text
## Implementation Plan — implement-all

Wave 1 (parallel):
  • postgres-upgrade   — touches: docker-compose.yml
  • vitest             — touches: frontend/package.json, frontend/vite.config.ts

Wave 2 (parallel):
  • ruff               — touches: requirements.txt, ruff.toml
  • mypy               — touches: requirements.txt, mypy.ini
  • hypothesis         — touches: requirements.txt, tests/unit/

Wave 3 (parallel):
  • pip-audit          — touches: requirements.txt (after ruff/mypy edits land)

Gating: each wave starts only after all agents in the previous wave report success.
```

Ask the user to confirm before proceeding: "Proceed with this plan? (yes / adjust)"
Wait for explicit confirmation. If the user adjusts the plan, revise and re-print before continuing.

### 5b-4 — Execute waves

For each wave in order:

1. Spawn one **background Agent** per item in the wave using the Agent tool with `run_in_background: true`.
   - Each agent prompt must include:
     - The item's `id`, `title`, and `rationale` from state.json.
     - A verbatim copy of the **Step 5 scope rules** from this skill.
     - The instruction: "Follow all conventions in CLAUDE.md. Implement this single recommendation only. Do not refactor unrelated code."
     - The full list of project files the item is expected to touch, so the agent reads them before editing.
   - Do **not** pass the state.json path to agents — state updates are handled here, not inside agents.

2. Wait for all agents in the current wave to complete (they run in background; you will be notified).

3. For each completed agent:
   - If success: set `status = "implemented"` for that item in state.json.
   - If failure: leave status as `"pending"`, append a `"last_error"` field with a one-line summary.

4. Save state.json after every wave (Step 6 rules apply).

5. Print a wave completion summary before starting the next wave:

   ```text
   Wave 1 complete: postgres-upgrade ✓  vitest ✓
   Starting Wave 2…
   ```

### 5b-5 — Final summary

After all waves finish, print:

```text
## implement-all complete

Implemented: postgres-upgrade, vitest, ruff, mypy, hypothesis
Failed (still pending): pip-audit — <one-line error>

Run /stack-review to re-audit remaining items.
```

---

## Step 6 — Save State

After the audit (Step 4) or an implement/dismiss action (Steps 2 or 5):

- Add any newly discovered recommendations (status: `"pending"`).
- Update statuses changed this run.
- Set `"last_run"` to today's date.
- Write back to `.claude/skills/stack-review/state.json`.

---

## Hard Rules

1. Never recommend something already in `todo.md` — it's already tracked.
2. Never recommend something with status `"dismissed"` — respect the decision.
3. Rationale must be specific to *this* project, not generic advice.
4. One implement run = one recommendation. Do not batch-implement — unless the `implement-all` argument was passed, in which case Step 5b governs and each agent still implements exactly one item.
