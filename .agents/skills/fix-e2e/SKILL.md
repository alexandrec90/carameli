---
name: fix-e2e
# No disable-model-invocation: this skill is invoked programmatically by /fix-all
# via the Skill tool. See .claude/rules/authoring.md (orchestrated sub-skill exception).
description: 'Fixes E2E test failures collected in logs/e2e-failures.log.'
---

# Skill: Fix E2E Failures

> Depends on the local stack and a browser runner being available.

Fix Playwright E2E failures collected in `logs/e2e-failures.log`. That log is written by the
check-run script (`scripts/run-e2e.py`) whenever the E2E suite runs — **this skill never runs
the full suite itself.** It reads the log, fixes the implicated code, and reruns only the
specific failed spec to confirm.

> **Verifying needs the local stack + frontend.** Reading the log and applying fixes works
> without them, but confirming a fix reruns the spec against the running app (`:8000`) and
> frontend (`:5173`), and `app/` fixes need `docker compose restart app` to take effect — a
> bad one can break the stack, which hands off to `/fix-docker` (Step 4). If the stack isn't
> up, apply the fix, stamp the log, and tell the user to bring it up (or re-run the check run)
> to verify.

---

## Step 1 — Collect & Match Known Fixes

Read `logs/e2e-failures.log` and `.claude/skills/fix-e2e/known-fixes.md` in a **single parallel
call** before anything else. Then act on the log's state:

| Log state | Action |
|---|---|
| Empty | E2E is green — stop. |
| Last line is `--- ADDRESSED`, or file missing | Stale/ungenerated — tell the user to re-run the check run (`scripts/run-e2e.py`, or the "Test: All Checks" task), then stop. Don't run the suite yourself. |
| Non-empty, last line ≠ `--- ADDRESSED` | Fresh — proceed below. |

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| A `# test_name[browser]` block has no traceback or error message lines (only a header + `# fix:` line) | The failure body wasn't captured — root cause is invisible |
| A failure block is missing a `# fix:` line entirely | Fix hint extraction failed — the block lacks actionability |
| A test appears failed in a summary but has no corresponding `# test_name` block | Failure body was dropped by the script's filter |
| Passing-spec output, screenshots/trace paths, or browser chatter bury the actual failures | Noise — the runner's filter is too loose; the real failures are unfindable |

If **any** quality problem is found:

1. Identify which test(s) are affected and which output pattern is missing **or** what noise
   is drowning the signal.
2. Update the producing E2E runner: **widen** the capture when detail is missing (e.g., always
   emit a `# fix:` hint, include assertion output), or **tighten** it when noise leaks (drop
   passing specs / trace-path chatter). Update the runner's test in the same change.
3. Note what was wrong and what you changed, then tell the user to regenerate the log (re-run
   the check run).
4. **Stop** — do not attempt fixes on a low-quality log, in either direction.

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

## Step 4 — Verify, then report

Rerun **only the spec(s) you fixed** to confirm — never the whole suite (the check-run script
owns that). E2E runs against the live stack, so the app and frontend (`:5173`) must be up:

- `pytest tests/e2e/<spec>.py -k <test>` — the specific fixed test(s) only.
- After `app/` edits, `docker compose restart app` **first** so the fix is live. Frontend
  (`frontend/src/`) edits are picked up by Vite HMR — no restart (config changes like
  `vite.config.ts` are the exception).

After a `docker compose restart app`, if the rerun errors on a container/connection failure
instead of a test assertion, a bad `app/` edit likely broke startup — check
`docker compose ps`, and if `app` is unhealthy/exited/restarting, run
`python scripts/docker-status.py` to refresh the `logs/docker/` artifacts with the current
failure, then invoke `/fix-docker` — rather than treating it as a test failure. Refreshing
first matters: `/fix-docker` skips any `logs/docker/` artifact stamped `--- ADDRESSED` from a
prior pass, so without a regenerate it may triage stale state instead of the startup break you
just caused.

If a rerun still fails, fix and rerun those same spec(s) again — up to **4 rounds**, stopping
early if a round ends with the same failures it began with (report the holdouts rather than
spinning). If the stack/frontend isn't up, skip the rerun: report the fixes you applied and
tell the user to bring the stack up (or re-run the check run) to verify.

Then report: which failures were fixed (test name, what changed, which files were edited)
and, for anything not fixed, an evidence-backed report — the failure, the evidence gathered,
and 2–3 concrete options with a recommendation — never a bare "skipped".

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Diagnose from the log, not by running the full E2E suite.** Verify only the spec(s) you
   fixed (Step 4) — never the whole suite or raw output dumps; the check-run script owns full
   runs.
4. If the log is already stamped `--- ADDRESSED` or missing, don't run the suite — tell the user
   to re-run the check run and stop.
5. Only stamp the log after applying at least one code fix.
6. **Never skip, never relax, never appease.** E2E failures are usually app bugs, not test
   bugs — fix the application code. Do not mark a failing spec skip/xfail. Do not delete
   one — removing coverage is the user's call, made via the Stop-conditions report. A test
   file may be edited only when evidence *outside the test* shows its expectation is
   wrong — the feature's contract, a deliberate behavior change in this branch, a
   documented API change — and the report must cite that evidence. An edit that only
   weakens an assertion (widens a selector/matcher, drops a check, pads a timeout to
   outwait a failure) is presumed appeasement: if you can't show the expectation was
   wrong, leave the spec red and report it with the evidence gathered and 2–3 concrete
   options.
7. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
8. **Do not read runtime logs (`carameli.log`) unless the fix hint says `5xx` and the route
   handler alone doesn't explain it.** Runtime logs are a last resort, not a first step.
9. **Log quality gate is mandatory (both directions).** If any failure block has no
    error/traceback lines, *or* passing-spec/browser noise buries the failures, update the
    producing E2E runner (and its test) and stop — never fix by hand from a suboptimal log.
