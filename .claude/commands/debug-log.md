# Debug Log Cleanup

Read `logs/voicegateway.log` and fix every ERROR and WARNING found in it.

## Step 1 — Read the log

Use the Read tool on `logs/voicegateway.log`. If it is very long (>500 lines), read only the last 500 lines using the `offset` parameter.

Also grep for the most severe lines first so you can prioritise:

- Grep `logs/voicegateway.log` for `| ERROR` — these must be fixed
- Grep `logs/voicegateway.log` for `| WARNING` — investigate each one
- Grep `logs/voicegateway.log` for `[FRONTEND]` — browser-side issues, fix in `frontend/src/`

## Step 2 — Triage

For each distinct error or warning pattern, record:

| # | Level | Module:line                  | Message summary             | Action   |
| - | ----- | ---------------------------- | --------------------------- | -------- |
| 1 | ERROR | app.api.vsapi.phone_lines:56 | Twilio error purchasing DID | Fix code |
| … |       |                              |                             |          |

Classify each as one of:

- **Code bug** — wrong logic, missing guard, unhandled case → fix it
- **Config issue** — missing/wrong env var, misconfigured Twilio SID → report clearly, fix if possible
- **Transient external failure** — Twilio 5xx, DB timeout → note it, do NOT force-fix

## Step 3 — Diagnose each code bug

The log format is:

```text
YYYY-MM-DD HH:MM:SS.mmm | LEVEL    | module.path:lineno | message
```

Convert the module path to a file path:

- `app.api.vsapi.phone_lines:56` → open `app/api/vsapi/phone_lines.py` at line 56
- `frontend` + `[FRONTEND]` tag → the error came from `frontend/src/` (check `context=` for the URL/component)

Read the source file at that line, then read enough surrounding context to understand what condition triggered the log entry.

## Step 4 — Fix code bugs

- Edit only the files directly implicated by the log entries.
- Do not refactor or clean up surrounding code that was not causing errors.
- If a fix requires a DB schema change, follow `.claude/rules/database.md` (generate an Alembic migration).
- Preserve all existing `logger.*` calls; add any that are missing per `.claude/rules/logging.md`.
- After each fix, write a one-line comment in your response linking it to the log entry it resolves.

## Step 5 — Verify

Run the test suite inside the container:

```bash
docker compose exec app pytest
```

Then tail the log briefly to confirm the fixed errors are gone:

```bash
tail -n 100 logs/voicegateway.log
```

Report the outcome: which errors are resolved, which are transient/config issues that need operator attention.
