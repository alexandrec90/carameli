---
agent: agent
tools: [read/readFile]
description: Read the VoiceGateway log file, identify errors and warnings, then diagnose and fix them.
---

# Debug Log & Fix Errors

Read the log file at `logs/voicegateway.log` and fix every ERROR and WARNING found.

## Step 1 — Read the log

```bash
cat logs/voicegateway.log
```

If the file is large, focus on the most recent 500 lines:

```bash
tail -n 500 logs/voicegateway.log
```

## Step 2 — Parse and triage

Group what you find into three buckets:

| Bucket | Criteria | Action |
| --- | --- | --- |
| **ERROR** | `\| ERROR \|` lines | Must fix — these are active failures |
| **WARNING** | `\| WARNING \|` lines | Investigate — may indicate a bug or misconfiguration |
| **[FRONTEND]** | Lines containing `[FRONTEND]` | Browser-side errors — fix in `frontend/src/` |

For each entry note:
- Timestamp
- Module and line number (third `|`-delimited field)
- The full message and any `context=` payload

## Step 3 — Reproduce and diagnose

For each ERROR/WARNING:

1. Open the source file identified in the log line (e.g., `app.api.vsapi.phone_lines:56`).
2. Read the surrounding code to understand what path produced the error.
3. Check if the error is:
   - A **code bug** (wrong logic, missing guard, unhandled case)
   - A **configuration issue** (bad env var, missing Twilio SID)
   - A **transient external failure** (Twilio 5xx, DB timeout) — note it but do not force-fix

## Step 4 — Fix code bugs

- Edit only the files implicated by the log. Do not refactor surrounding code.
- After each fix, note which log line it addresses.
- If a fix requires a new Alembic migration, follow `.claude/rules/database.md`.
- If a fix touches a route handler, follow the logging conventions in `.claude/rules/logging.md` (keep `logger.*` calls in place, add any that are missing).

## Step 5 — Verify

After applying fixes:

1. Run the test suite:
   ```bash
   docker compose exec app pytest
   ```
2. Tail the log to confirm the fixed errors no longer appear under normal operation:
   ```bash
   tail -f logs/voicegateway.log
   ```
3. If frontend errors were present, check the browser console as well.

## Log format reference

```
2026-02-21 14:30:00.123 | ERROR    | app.api.vsapi.phone_lines:56 | Twilio error purchasing DID vs_customer_id=42: Invalid phone number
                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                      open this file at this line   this is the message to fix
```

`[FRONTEND]` entries originate from the React app and were shipped via `POST /vg/1.0.0/frontend-logs`. Fix them in `frontend/src/`.
