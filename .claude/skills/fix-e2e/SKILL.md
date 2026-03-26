---
name: fix-e2e
description: 'Fixes E2E test failures from logs/e2e-failures.log (written by the Test: Run E2E task).'
argument-hint: '(no arguments)'
---

# Skill: Fix E2E Failures

Fix Playwright E2E failures collected in `logs/e2e-failures.log`.

---

## Step 1 — Collect Failures

Read `logs/e2e-failures.log` with the Read tool. If the file does not exist or is empty,
tell the user to run the **Test: Run E2E (headless)** task first, then stop.

### Addressed check

If the last line of `logs/e2e-failures.log` is `--- ADDRESSED`, the failures in this file
have already been fixed in a prior run and the user has not re-run the E2E task since.
Tell the user:

> These E2E failures were already addressed. Re-run the **Test: Run E2E (headless)** task
> and invoke `/fix-e2e` again if new failures appear.

Then **stop** — do not re-triage or re-fix anything.

The `Test: Run E2E` task overwrites the entire file on each run, so the marker is
naturally cleared whenever the user re-runs E2E tests.

### Known-fix lookup

Before reasoning about each failure, read `.claude/skills/fix-e2e/known-fixes.md`.
For every collected error, check if any **Error pattern** substring appears in the
traceback, error line, or `# fix:` hint. If a match is found, apply the documented fix
directly as a one-shot — do not re-derive the solution from scratch.

For every matched row, increment its **Hits** column by 1 and set **Last used** to
today's date (`YYYY-MM-DD`). Do this in the same Edit call that stamps
`--- ADDRESSED` — no extra tool call needed.

### Triage

If the file is **not** addressed, collect lines starting with `FAILED` or `ERROR` (from
the `# summary` section) and the structured failure blocks above them. Each block has:

- `# test_name[browser]` — the failing test
- `# fix: <hint>` — a machine-generated fix hint from the test runner
- Traceback / assertion lines

Build a triage list from these blocks.

---

## Step 2 — Diagnose

E2E failures usually indicate **application code** issues, not test bugs. Before editing:

1. Read the failing **test code** in `tests/e2e/` to understand what it asserts.
2. Read the **application code** the test exercises (route handlers, frontend components,
   Vite proxy config, CORS settings, etc.).
3. Use the `# fix:` hint in each failure block as a starting point — these are generated
   by the test runner's `Get-FixHint` function and point to the most common root causes.

### Where to look by fix hint

| Fix hint keyword | Likely location |
|---|---|
| `5xx` / `backend endpoint` | Route handler in `app/api/`, backend logs in `logs/runtime/carameli.log` |
| `CORS` / `Access-Control` | CORS middleware in `app/main.py` or `app/core/` |
| `4xx` / `auth` | Auth dependency, route registration, schema mismatch |
| `Timeout` / `navigation` | Frontend component not rendering, missing route in `frontend/src/routes.ts` |
| `connection refused` | Backend or frontend dev server not running (not a code fix — tell the user) |
| `DOM element not found` | Selector mismatch between test and actual rendered markup |
| `collection error` | Import error or missing fixture in `tests/e2e/` |

---

## Step 3 — Apply Fixes

For each failure:

1. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
2. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
3. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable failures, append the line `--- ADDRESSED` to the end of
`logs/e2e-failures.log` using the Edit tool. This prevents the same failures from being
re-triaged on the next `/fix-e2e` invocation.

### Update known-fixes table

After all fixes are applied, review the failures you just fixed. If any failure
**was not already covered** by a row in `known-fixes.md` and its error pattern is
likely to recur (i.e., it is not a one-off typo), append a new row to the table in
`.claude/skills/fix-e2e/known-fixes.md` with:

- **Error pattern** — the shortest distinctive substring from the traceback/error line
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add entries for unique, non-recurring mistakes (e.g., a misspelled variable
name in one test). Only add patterns that could plausibly appear again.

### Prune stale entries

While editing `known-fixes.md`, check for rows where **Hits = 0** and **Added** is
more than 90 days ago. Delete those rows — they were seeded but never matched a real
failure, so they just consume context tokens for no benefit.

**Stop conditions:**

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask for
  confirmation.
- The fix hint is `connection refused` → this is an infra issue, not a code fix. Tell the
  user to ensure both servers are running and stop.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 4 — Report

State clearly:

- Which failures were fixed (test name, what changed, which files were edited).
- Which were skipped and why.
- **Restart reminders** (as applicable):
  - If any source files under `app/` were changed, tell the user to restart the backend:

    ```sh
    docker compose restart app
    ```

  - If any files under `frontend/src/` were changed, tell the user to check the Vite dev
    server picked up the changes (usually automatic with HMR, but a manual restart may be
    needed for config changes like `vite.config.ts`).
- Tell the user to re-run the **Test: Run E2E (headless)** task and then invoke `/fix-e2e`
  again if failures remain.

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Never run E2E tests yourself.** Do not invoke `pytest`, `playwright`, or any test
   runner command. All test execution is done by the user via the VS Code task.
4. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run E2E first.
5. Only stamp the log after applying at least one code fix.
6. E2E failures are usually app bugs, not test bugs — prefer fixing application code over
   modifying tests. Only edit test files if the test itself is genuinely wrong.
