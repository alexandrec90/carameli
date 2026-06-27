---
name: fix-tests
disable-model-invocation: true
argument-hint: 'Optional: "desktop" | "mobile" to skip env detection (else auto-detects via docker info)'
description: 'Fixes test failures collected in logs/test-failures.log.'
---

# Skill: Fix Test Failures

Candidate rewrite of `.claude/skills/fix-tests/SKILL.md` — a leaner version kept for
A/B testing via `npm run eval:rewrite`. Not loaded as a skill (skills load from
`.claude/skills/*/SKILL.md` only). If it wins on accuracy + tokens, promote it.

> **Cross-environment.** Reads `logs/test-failures.log` (written by the test suite —
> locally or by the On-Demand CI workflow). Fixing is the same everywhere.

Environment arg: `desktop` = Docker reachable, `mobile` = not. If omitted, check once with
`docker info` at the start of Step 3. Never infer the environment from the branch name.

## Step 1 — Read log + known fixes (parallel, first action)

Read `logs/test-failures.log` and `.claude/skills/fix-tests/known-fixes.md` in a single
parallel call **before running anything**. Then act on the log's state:

| Log state | Action |
|---|---|
| Non-empty, last line ≠ `--- ADDRESSED` | **Fresh** — proceed. Do not re-run any test command. |
| Empty | Green — stop. |
| Last line is `--- ADDRESSED`, or file missing | **Stale/ungenerated** — regenerate (Docker up: restart app if `app/` changed, run the suite; Docker down: push on a `fix/auto-*` branch or ask). Stop this turn; restart on the fresh log. |

**Log-quality gate (mandatory).** If any failure block has the
`[raw fallback: no E-lines in filtered output]` marker, or has no `E` lines and no
`app/`/`tests/` frame, or a `FAILED` summary line has no `___` block — the traceback was
stripped and the cause is invisible. **Do not fix source.** Widen the filter in
`scripts/diagnostics.py` (`filter_pytest_output`), update `scripts/hooks/tests/test_diagnostics.py`
in the same edit, regenerate, and restart from Step 1. The `# source:` header names the runner.

**Known-fix short-circuit (mandatory).** For each failure, if any `known-fixes.md` pattern
substring appears in the traceback/error line, apply that fix immediately — no extra reads,
no re-derivation. Bump the row's **Hits** and set **Last used** to today.

## Step 2 — Fix unmatched failures

For each remaining failure, apply the **smallest** fix — no refactors, no unrelated cleanup.
Preserve existing `logger.*` calls; add any missing per `.claude/rules/logging.md`. If a fix
needs a DB schema change, stop and use `/add-db-model`.

After applying at least one fix, append `--- ADDRESSED` to `logs/test-failures.log`. Add a
`known-fixes.md` row for any new pattern likely to recur; prune zero-hit rows older than 90 days.

## Step 3 — Report & loop

State what was fixed (file, test, change) and what was skipped (genuine stop conditions only).
Your deliverable is the fix + the `--- ADDRESSED` stamp — that completes in any environment.

**If Docker is reachable, close the loop:** make `app/` edits live (`docker compose restart app`;
test-only edits need no restart), regenerate the log, repeat from Step 1 until empty — cap **4
iterations**, stopping early if an iteration ends with the same failures it began with. Rerun
**selectively** — the failed node IDs, or the changed-only (testmon) run to catch regressions —
**never the full suite per fix**. A multi-section log (frontend/hook/telnyx) needs
`python scripts/run-tests.py --all` to regenerate; a pytest-only rerun blanks the other sections.
Don't pipe streamed test output into context — read the capped log. **If Docker is not reachable**,
finish the fix, stamp, report, and stop; whatever runs the suite next produces the fresh log.
