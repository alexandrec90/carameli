---
name: fix-tests
disable-model-invocation: true
argument-hint: 'Optional: "desktop" | "mobile" to skip env detection (else auto-detects via docker info)'
description: 'Fixes test failures collected in logs/test-failures.log.'
---

# Skill: Fix Test Failures

> **Cross-environment.** Reads `logs/test-failures.log`, produced whenever the test suite
> runs — locally during a check run, or in CI by the On-Demand Lint + Test workflow (open
> the PR it creates, then run this skill). Fixing works the same either way.

Fix failing tests collected in `logs/test-failures.log`.

Accepts an optional environment argument: `desktop` or `mobile`. When given, skip the `docker info` check — treat `desktop` as Docker reachable and `mobile` as Docker not reachable. When omitted, check with `docker info` once at the start of Step 3.

The fix steps are the same everywhere — read the log, edit the implicated code. One thing
differs by environment, and only after you change a file under `app/`:

- **`desktop` / Docker reachable**: run tests locally via
  `docker compose exec -T app pytest ...`. `app/` changes need `docker compose restart app`
  first; test-only edits need no restart. **This is always preferred — use it whenever
  Docker is up, regardless of the branch name.**
- **`mobile` / Docker not reachable**: you cannot run tests locally — there is **no
  verification loop**, so do not investigate-loop (see the one-pass guard in Step 2). If on a
  `fix/auto-*` branch, the next push triggers CI which rebuilds and reruns. Otherwise
  (sandbox / headless eval), stamp `--- ADDRESSED` and stop — whatever runs the suite
  next produces the fresh log.

When no argument is given, check Docker availability **once at the start of Step 3** with `docker info`. Do not infer environment from the branch name.

---

## Step 1 — Collect & Match Known Fixes

> **MANDATORY FIRST ACTION**: Read `logs/test-failures.log` and
> `known-fixes.md` in a single parallel call before doing anything else.
> Skipping this step violates the hard rules.

Read these two files **in parallel** (single tool call):

- `logs/test-failures.log`
- `.claude/skills/fix-tests/known-fixes.md`

**Decide what to do based on what you just read — do not run any test command before checking:**

| Log state | Action |
|---|---|
| Non-empty, last line is NOT `--- ADDRESSED` | **Fresh** — proceed to known-fix matching below. **Do not re-run any test command.** |
| Empty | Tests are green — stop. |
| Last line is `--- ADDRESSED` | **Stale** — regenerate it. If Docker is up: restart the app if `app/` changed, then run the suite. If Docker is down: push (on a `fix/auto-*` branch) or ask the user to run the suite. Stop this turn; restart on the fresh log. |
| File doesn't exist | Not yet generated — generate it. If Docker is up: run the suite. If Docker is down: push (on a `fix/auto-*` branch) or ask the user. Stop this turn; restart on the fresh log once present. |

### Log quality gate

Before investing in fixes, scan the log for these signals of incomplete diagnostics:

| Signal | What it means |
|---|---|
| `[raw fallback: no E-lines in filtered output]` in a failure block | The script's filter stripped the actionable lines — the block is noise without signal |
| A failure block has **no** `E` lines AND **no** `app/` or `tests/` frame | The traceback was filtered out entirely — root cause is invisible |
| A `FAILED` test appears in the short-test-summary but has **no** corresponding `___` block | The failure body was never captured |

If **any** quality problem is found:

1. Identify which test(s) are affected and which output pattern was lost.
2. Relax the filter in `scripts/diagnostics.py` (`filter_pytest_output`) — widen the
   line-keep conditions, raise the per-block cap, or preserve the missing frame pattern.
   That one module is shared by the local task and CI (the `# source:` header names the
   runner that called it), so a single change covers every environment. Update its tests
   in `scripts/hooks/tests/test_diagnostics.py` in the same edit.
3. Note what was wrong and what you changed, then regenerate the log with the improved
   filter (locally: re-run the suite; CI: push) and restart from Step 1 on the
   higher-quality output.
4. Do not attempt fixes on the current low-quality log — fix the filter first.

### Known-fix matching (mandatory — do this BEFORE any other file reads)

For every failure in the log, check if any **Error pattern** substring from
`known-fixes.md` appears in the traceback or error line.

**If a known fix matches: apply it immediately as a one-shot fix.** Do not read
additional files to re-derive the solution. Just apply the documented fix, increment
the **Hits** column by 1, set **Last used** to today's date, and move on to the next
failure.

Only proceed to Step 2 for failures that have **no known-fix match**.

### Triage unmatched failures

For any failure not matched by a known fix, collect lines starting with `FAILED` or
`ERROR` and the traceback immediately following each. Build a triage list.

---

## Step 2 — Diagnose & Fix (unmatched failures only)

Skip this step entirely if all failures were resolved by known fixes in Step 1.

### Cloud/mobile (Docker not reachable): one pass, no spiral

On a cloud/mobile session you **cannot run the suite to verify a fix** — there is no feedback
loop, so iterative hypothesis-testing has nothing to converge against and will burn the whole
token budget without fixing anything (this is the exact failure that motivated this guard).
Hard limits when Docker is unreachable:

- Known-fix short-circuits from Step 1 are your main tool — apply them as one-shots.
- For an unmatched failure, read each implicated file **at most once**, then either apply a
  single minimal fix you are confident in, or — if you can't be confident without running the
  test — **stop investigating it.** Record it as needing a local session and move to the next.
- **Never re-read a file you've already read** to keep theorizing, and never push one
  speculative fix after another hoping CI turns green. One fix pass, stamp, push, done.
- **Frontend/vitest failures are out of scope here.** CI splits them into
  `logs/frontend-test-failures.log` (not the log you read), and they can't run on a cloud
  session; if you ever see a `frontend-tests` section, report it for a local session — don't fix it.

### Applying fixes

For each failure:

1. Apply the **smallest reasonable fix** — no refactors, no unrelated cleanup.
2. Preserve all existing `logger.*` calls; add any that are missing per
   `.claude/rules/logging.md`.
3. If a fix requires a DB schema change, note it and stop — use `/add-db-model` instead.

**After fixing** all actionable failures, append `--- ADDRESSED` to the end of
`logs/test-failures.log`.

### Update known-fixes table

After all fixes are applied, if any failure **was not already covered** by a row in
`known-fixes.md` and its error pattern is likely to recur, append a new row with:

- **Error pattern** — shortest distinctive substring from the traceback/error line
- **Root cause** — one-line explanation
- **Fix** — the action you took
- **Hits** — `1`
- **Last used** — today's date
- **Added** — today's date

Do **not** add entries for one-off mistakes.

### Prune stale entries

While editing `known-fixes.md`, delete rows where **Hits = 0** and **Added** is more
than 90 days ago.

### Stop conditions

- A fix would require a non-trivial refactor → propose a minimal safe fix and ask.
- Required context is missing → ask a single clarifying question and stop.

---

## Step 3 — Report

State clearly:

- Which failures were fixed (file, test name, what changed).
- Which were skipped and why (only genuine stop conditions).

Your deliverable is the **fix plus the `--- ADDRESSED` stamp** — that needs no test runner
and completes in any environment (including a headless eval that only seeds the log).

**If Docker is reachable, close the loop yourself:** make `app/` changes live
(`docker compose restart app` for `app/` edits; test-only edits need no restart),
regenerate the log, and repeat from Step 1 until it's empty — capped at **4 iterations**,
and stopping early if an iteration ends with the **same set of failures** it began with
(no progress: report the stuck failures rather than spinning). If the cap is hit with
failures still present, report what remains and tell the user to re-invoke `/fix-tests`
after reviewing them. Regenerate at the **breadth of the log**:
a pytest-only log → the selective/testmon pytest rerun above; a multi-section log (the
aggregate "Test: All Suites" output) → `python scripts/run-tests.py --all`, so every section
is reproduced rather than blanked. Don't stop at a half-fixed state and wait
for a human. **If Docker is not reachable**, you can't regenerate locally: finish the fix,
stamp `--- ADDRESSED`, report, and stop. Whatever runs the suite next produces the fresh log.

> When you regenerate locally, the suite streams every test line — don't pipe that into
> context; discard the run's stdout and read the capped `logs/test-failures.log` instead
> (background a slow run so the turn isn't blocked). Waiting on pytest costs latency, not
> tokens; ingesting its raw output is what costs tokens.

---

## Hard Rules

1. Edit only files directly implicated by the collected failures — never pre-emptive cleanup.
2. One failure = one minimal fix. Do not restructure surrounding code.
3. **Rerun selectively — never the whole suite to verify a fix.** You already have the failed
   node IDs from the log; after a fix, rerun exactly those
   (`docker compose exec -T app pytest tests/...::test_a tests/...::test_b`). To gate a pass
   against regressions, use the changed-only (testmon) run — it reruns just the tests your
   edits touched, including any previously-passing one your fix breaks. Reserve a cold full
   suite for when the testmon graph looks stale. These reruns cover **pytest only** — if the
   log also has `frontend-tests`, `hook-tests`, or `telnyx-sandbox` sections, regenerate the
   full artifact with `python scripts/run-tests.py --all` (the single writer for all four
   targets). A pytest-only rerun overwrites the file with just its own section and silently
   blanks the others, so the loop would report green while those sections were never re-run.
4. If the log is stamped `--- ADDRESSED`, it's stale — regenerate it before fixing (don't fix
   against a stale log).
5. Only stamp the log after applying at least one code fix.
6. **Known fixes are mandatory short-circuits.** If a known-fix pattern matches, apply it
   immediately. Do not investigate, do not read additional files, do not re-derive the fix.
7. **Log quality gate is mandatory.** If any failure block has no traceback (no `E` lines,
   no `app/`/`tests/` frames), update the producing filter (named on the log's `# source:`
   header) and stop — never attempt fixes on a log where the root cause is invisible.
8. **Cloud/mobile = no verification loop, so no investigation spiral.** When Docker is
   unreachable: known-fix one-shots, then at most one minimal confident fix per unmatched
   failure (each implicated file read once); otherwise report it for a local session. Never
   re-read files to keep theorizing, never chain speculative push→poll rounds, and never
   attempt frontend/vitest failures — they can't run on a cloud session.
