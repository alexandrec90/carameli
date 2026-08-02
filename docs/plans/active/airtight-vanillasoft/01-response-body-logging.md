# Phase 01 — Log VanillaSoft's error responses on failed notifies

> Read `00-overview.md` first. Carameli repo only. No new dependencies, no migration
> (unless the optional step is taken). Small, ships alone, valuable immediately: today
> VanillaSoft's error text is thrown away, and after phase 02 that body *is* the
> VanillaSoft-side stack trace / failure reason.

## Current behavior

[`app/services/vanillasoft_notify.py`](../../../../app/services/vanillasoft_notify.py) —
`post_notification(path, payload)` (~lines 121–136):

- transport exception → `logger.exception(...)`, returns `False` ✔ (fine as-is)
- non-2xx → `logger.warning("VanillaSoft notify POST returned %s path=%s", resp.status_code, path)`
  — **the response body is discarded**. That's the gap.

## Change

1. On non-2xx, log status **and a truncated response body** at `WARNING` (or `ERROR` for
   5xx — implementer's choice, be consistent), e.g.:

   ```python
   logger.warning(
       "VanillaSoft notify POST returned %s path=%s body=%s",
       resp.status_code,
       path,
       _truncate(resp.text),
   )
   ```

   Add a module-level `_truncate(text: str, limit: int = 2000) -> str` helper (append an
   ellipsis marker when truncated). 2000 chars is enough for an ASP.NET error payload
   without flooding the log. Lazy `%s` formatting, never f-strings (logging rule).

2. Include a correlating identifier when available. `post_notification`'s signature only
   has `path` + `payload`; the payload always carries `callId` or `referenceId` — log
   `payload.get("callId") or payload.get("referenceId")` as `ref=%s` so an agent can join
   the failure to a `call_events` / `sms_messages` row. Do **not** log the whole payload
   (PII rule: identifiers only).

3. **Optional, only if trivial after inspecting the models**: persist the last failure on
   the unposted row (`last_post_error: str | None` column on `call_events` and
   `sms_messages`) so the error is queryable via `mcp__postgres__query`, not just greppable.
   This requires an Alembic migration + model change (`app/CLAUDE.md`) and
   plumbing the error string through the callers in `app/api/webhooks/call_status.py`,
   `app/api/webhooks/sms_inbound.py`, `app/services/call_sync.py`, `app/services/sms_sync.py`
   — meaning `post_notification` should return the error detail, not just `bool`
   (e.g. `tuple[bool, str | None]`, or a small frozen dataclass). If that ripples too far,
   **skip it** — the log line is the required deliverable; note the skip in the commit body.

## Tests (same commit)

Extend
[`tests/unit/test_vanillasoft_notify.py`](../../../../tests/unit/test_vanillasoft_notify.py)
— it already covers `post_notification` by monkeypatching settings and patching
`app.services.vanillasoft_notify.httpx.AsyncClient` with `unittest.mock` (see
`test_post_notification_non_2xx_returns_false` for the pattern; **reuse it**, don't
introduce respx or new deps):

- non-2xx response with a body → returns `False` **and** the log record (use pytest's
  `caplog`) contains the status, the truncated body, and the `ref` identifier
- body longer than the truncation limit → log contains the marker and is capped
- `_truncate` unit cases (short body unchanged, exact-limit boundary)
- existing tests still pass unmodified (no behavior change on success/exception paths)

## Verify

```sh
pytest tests/unit/test_vanillasoft_notify.py
ruff check app/services/vanillasoft_notify.py tests/unit/test_vanillasoft_notify.py
mypy app/services/vanillasoft_notify.py
```

(Stack down? Write tests anyway, defer execution to CI — per `CLAUDE.md`.)
