---
name: fix-all
disable-model-invocation: true
description: 'Runs fix-lint, fix-tests, and fix-e2e in sequence. Use when you want to fix all outstanding lint, test, and E2E failures in one pass.'
---

# Skill: Fix All

> **Local session only.** This skill reads log artifacts written by PS1 scripts
> on the host machine. It cannot run in web or mobile sessions.

Delegates to the three canonical fixers in order: lint, tests, E2E.

---

## Step 1 — Determine which logs have failures

Read all three log files **in parallel** (single tool call):

- `logs/lint-errors.log`
- `logs/test-failures.log`
- `logs/e2e-failures.log`

For each file: it is **active** if it exists, is non-empty, and its last line is not
`--- ADDRESSED`. Skip files that are missing, empty, or already addressed.

If **no** log is active, tell the user all checks are clean and stop.

---

## Step 2 — Run fixers for active logs

For each active log, invoke the corresponding skill:

| Active log | Skill to invoke |
|---|---|
| `logs/lint-errors.log` | `/fix-lint` |
| `logs/test-failures.log` | `/fix-tests` |
| `logs/e2e-failures.log` | `/fix-e2e` |

Run them **sequentially** — lint first, tests second, E2E third. Each skill may edit
source files; later skills must see the results of earlier edits.

Invoke each skill using the Skill tool exactly as if the user had typed the slash command.

---

## Step 3 — Report

After all active fixers complete, summarize:

- Which fixers ran and their outcome (all matched / partial / none matched).
- Which files were changed.
- Any unmatched failures still remaining in trimmed logs.
- Next step for the user: re-run the **CI: Check + Fix Known Issues** task to verify.

---

## Hard Rules

1. Never skip a fixer for an active log — all three must run if their log is active.
2. Run sequentially, not in parallel — edits from one fixer may affect what another finds.
3. Do not read individual log files beyond Step 1 — each sub-skill handles its own log.
4. Do not apply any fixes directly — all fixing is delegated to the sub-skills.
