---
name: fix-tests-auto
description: 'Autonomous test-fix loop: runs pytest, reads failures, applies fixes, restarts app if needed, and repeats until green or stuck. Use when you want hands-off iteration instead of the manual fix-tests workflow. Parameterless.'
argument-hint: '(no arguments)'
---

# Skill: Autonomous Test-Fix Loop

Runs the full fix-tests cycle autonomously without user interaction between iterations.

---

## Prerequisites

The Docker stack must already be running. If it is not, stop and tell the user to run
the **Start: Full Stack (Docker Compose)** task first.

---

## Before the loop

Read `logs/test-failures.log` before running anything.

- If the file is **non-empty** and does **not** end with `--- ADDRESSED`: failures are
  already collected and unaddressed. Skip the first test run — go straight to **C**
  (known fixes) for iteration 1.
- Otherwise (file is empty, missing, or ends with `--- ADDRESSED`): proceed normally
  from **A**.

---

## Loop

Cap at **4 iterations**. On each iteration:

### A — Run tests

Run `pwsh -ExecutionPolicy Bypass -File scripts/run-tests.ps1` in the terminal with
`isBackground=false` and a **timeout of 360000 ms** (6 minutes). This blocks in a single
call until the script exits, writing `logs/test-failures.log` automatically. Do not poll
with `get_terminal_output` — the blocking call handles it.

### B — Check result

Read `logs/test-failures.log`.

- If the file is **empty** (all tests pass): report a clean suite and **stop**.
- If the file ends with `--- ADDRESSED`: this should not happen mid-loop; treat it
  as a bug, clear the marker, and continue to the next iteration.
- Otherwise: proceed to fix.

### C — Read known fixes

Read `.claude/skills/fix-tests/known-fixes.md` before reasoning about any failure.
Apply documented patterns directly rather than re-deriving solutions.
Increment **Hits** and set **Last used** for every matched row.

### D — Triage failures

Collect all `FAILED` / `ERROR` lines and their tracebacks from the log.
Build a triage list for this iteration.

**Hard stop conditions** (stop the loop immediately, report remaining failures):

- Any failure requires a DB schema change → tell user to use `/add-db-model`.
- Any failure requires a non-trivial refactor → propose the change and ask for
  confirmation.
- The same set of failures appeared in the previous iteration (no progress) →
  the agent is stuck; report and stop.

### E — Apply fixes

For each failure:

1. Read the relevant file for context.
2. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
3. Preserve all existing `logger.*` calls; add missing ones per the logging rules.
4. Edit only files directly implicated by the failure.

### F — Restart if needed

If any file under `app/` was changed in this iteration, run `docker compose restart app`
in the terminal with `isBackground=false` and a **timeout of 60000 ms** before the next
test run. If only `tests/` files changed, skip the restart.

### G — Loop

Append `--- ADDRESSED` to `logs/test-failures.log`, then go back to **A**.

---

## After the loop

### Update known-fixes table

Review all failures fixed across all iterations. For any pattern **not already in**
`.claude/skills/fix-tests/known-fixes.md` that is likely to recur, append a new row:

- **Error pattern** — shortest distinctive substring
- **Root cause** — one-line explanation
- **Fix** — action taken
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Prune rows where **Hits = 0** and **Added** is more than 90 days ago.

---

## Final report

State:

- How many iterations ran.
- Which failures were fixed (file, test name, what changed).
- Which failures remain and why the loop stopped (pass / stuck / stop condition hit /
  iteration cap reached).
- If the cap was reached with failures still present, tell the user to invoke
  `/fix-tests` or `/fix-tests-auto` again after reviewing the remaining failures.
