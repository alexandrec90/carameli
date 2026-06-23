---
name: fix-e2e
disable-model-invocation: true
description: 'Fixes E2E test failures from logs/e2e-failures.log (written by the Test: Run E2E task).'
---

# Skill: Fix E2E Failures

> **Local session only.** This skill reads log artifacts written by PS1 scripts
> on the host machine. It cannot run in web or mobile sessions.

Fix Playwright E2E failures collected in `logs/e2e-failures.log`.

---

## Step 1 — Collect & Match Known Fixes

Read these two files **in parallel** (single tool call):

- `logs/e2e-failures.log`
- `.claude/skills/fix-e2e/known-fixes.md`

If the log file does not exist or is empty, tell the user to run the **Test: Run E2E
(headless)** task first, then stop.

### Addressed check

If the last line of `logs/e2e-failures.log` is `--- ADDRESSED`, the failures have
already been fixed. Tell the user:

> These E2E failures were already addressed. Re-run the **Test: Run E2E (headless)**
> task and invoke `/fix-e2e` again if new failures appear.

Then **stop**.

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| A `# test_name[browser]` block has no traceback or error message lines (only a header + `# fix:` line) | The failure body wasn't captured — root cause is invisible |
| A failure block is missing a `# fix:` line entirely | Fix hint extraction failed — the block lacks actionability |
| A test appears failed in a summary but has no corresponding `# test_name` block | Failure body was dropped by the script's filter |

If **any** quality problem is found:

1. Identify which test(s) are affected and which output pattern is missing.
2. Update `scripts/run-e2e.ps1` to preserve the missing content (e.g., always emit a
   `# fix:` hint, widen the block-capture logic to include assertion output).
3. Tell the user: what was wrong, what was changed, and ask them to re-run the
   **Test: Run E2E (headless)** task.
4. **Stop** — do not attempt fixes on a low-quality log.

### Known-fix matching (mandatory — do this BEFORE any other file reads)

For every failure block in the log, check if any **Error pattern** substring from
`known-fixes.md` appears in the traceback, error line, or `# fix:` hint.

**If a known fix matches: apply it immediately as a one-shot fix.** Do not read
additional files to re-derive the solution. Do not investigate further. Just apply the
documented fix, increment the **Hits** column by 1, set **Last used** to today's date,
and move on to the next failure.

Only proceed to Step 2 for failures that have **no known-fix match**.

### Triage unmatched failures

For any failure not matched by a known fix, collect its structured block:

- `# test_name[browser]` — the failing test
- `# fix: <hint>` — machine-generated fix hint
- Traceback / assertion lines

---

## Step 2 — Diagnose (unmatched failures only)

Skip this step entirely if all failures were resolved by known fixes in Step 1.

### Do NOT read runtime logs speculatively

Do not read `logs/runtime/carameli.log` unless the fix hint specifically says `5xx` /
`backend endpoint` AND the test code + route handler don't reveal the cause. Runtime
logs are large and usually add noise, not signal.

### Where to look by fix hint

| Fix hint keyword | Read first |
|---|---|
| `5xx` / `backend endpoint` | Route handler in `app/api/`; also check `app/api/vsapi/__init__.py` for route registration |
| `CORS` / `Access-Control` | `app/main.py` CORS middleware section |
| `4xx` / `auth` | Auth dependency in `app/core/auth.py`, then the route |
| `Timeout` / `navigation` | Frontend component, then `frontend/src/routes.ts` |
| `connection refused` | **Stop** — not a code fix, tell the user to start servers |
| `DOM element not found` | The frontend component rendering the selector |
| `collection error` | The test file imports and `conftest.py` |

---

## Step 3 — Apply Fixes

For each failure:

1. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
2. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
3. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable failures, append `--- ADDRESSED` to the end of
`logs/e2e-failures.log`. This prevents re-triage on the next invocation.

### Update known-fixes table

After all fixes are applied, if any failure **was not already covered** by a row in
`known-fixes.md` and its error pattern is likely to recur, append a new row with:

- **Error pattern** — shortest distinctive substring from the traceback/error line
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add entries for one-off mistakes (e.g., a misspelled variable name).

### Prune stale entries

While editing `known-fixes.md`, delete rows where **Hits = 0** and **Added** is more
than 90 days ago.

### Stop conditions

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask.
- The fix hint is `connection refused` → infra issue, tell the user and stop.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 4 — Report

State clearly:

- Which failures were fixed (test name, what changed, which files were edited).
- Which were skipped and why.
- **Restart reminders** (as applicable):
   - Backend files changed (`app/`): tell the user to run:

      ```powershell
      docker compose restart app

  - Frontend files changed (`frontend/src/`): note that Vite HMR should pick it up
    (manual restart only needed for config changes like `vite.config.ts`)
---


1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Diagnose from the log, not by running the full E2E suite.** After a fix you may run the
   single spec you fixed (e.g. `pytest tests/e2e/<spec>.py -k <test>`) to confirm it, provided the
   stack and frontend (`:5173`) are up. Do not run the whole suite or dump raw output; the full
   E2E task remains the user's to re-run.
4. Skip the log file if already stamped `--- ADDRESSED` — tell the user to re-run E2E first.
5. Only stamp the log after applying at least one code fix.
6. E2E failures are usually app bugs, not test bugs — prefer fixing application code over
   modifying tests. Only edit test files if the test itself is genuinely wrong.
7. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
8. **Do not read runtime logs (`carameli.log`) unless the fix hint says `5xx` and the route
   handler alone doesn't explain it.** Runtime logs are a last resort, not a first step.
9. **Log quality gate is mandatory.** If any failure block has no error/traceback lines,
    update `scripts/run-e2e.ps1` and stop — never attempt fixes when root cause is invisible.
