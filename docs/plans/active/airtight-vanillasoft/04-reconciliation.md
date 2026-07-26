# Phase 04 — Reconciliation cron (catch webhooks that never arrived)

> Read `00-overview.md` first. Carameli repo only. This is the net under the one failure
> mode nobody can log at the time it happens: a Jambonz/Telnyx webhook that never reaches
> Carameli (ngrok tunnel down, machine asleep, transient outage). A cron periodically asks
> the providers what happened and diffs against local tables; anything provider-side that
> Carameli never recorded is logged as an ERROR with enough identifiers for an agent to act.
> No new pip dependencies (use the providers' existing `httpx` plumbing).

## Design constraints (from repo rules — read the rule files before coding)

- **Provider boundary** (`.claude/rules/voip-providers.md`): new capabilities are added to
  the Protocols in `app/services/providers/base.py`, implemented in
  `carrier/telnyx.py` / `engine/jambonz.py`, and consumed only through the Protocol.
  Tests mock at this boundary — never at SDK/HTTP internals.
- **ARQ cron pattern**: crons are registered in `WorkerSettings.cron_jobs` in
  `app/services/call_sync.py`. Sessions come from `async_session_factory`. For provider
  instances inside the worker (no `app.state` there), mirror how
  `app/services/agent_status_sync.py` creates/holds its engine provider via the worker
  `startup`/`shutdown` hooks — read it first and follow the same lifecycle.

## Part A — Provider protocol additions (`app/services/providers/base.py`)

Two read-only listing methods plus small record dataclasses (keep them in `base.py` so
consumers import only from there):

```python
@dataclass(frozen=True)
class ProviderCallRecord:
    call_sid: str
    direction: str | None
    from_number: str | None
    to_number: str | None
    started_at: datetime | None
    status: str | None


@dataclass(frozen=True)
class ProviderMessageRecord:
    message_sid: str
    direction: str | None
    from_number: str | None
    to_number: str | None
    created_at: datetime | None
    status: str | None
```

- `CallEngineProvider.list_recent_calls(since: datetime) -> list[ProviderCallRecord]`
- `CarrierProvider.list_recent_messages(since: datetime) -> list[ProviderMessageRecord]`

Implementations:

- **Jambonz** (`engine/jambonz.py`): the REST API exposes recent-call listing
  (`GET /v1/Accounts/{account_sid}/RecentCalls`, paginated, filterable by start date) —
  consult the jambonz API docs for exact params and map to `ProviderCallRecord`
  (`call_sid` = jambonz `call_sid`). Follow the file's existing request-helper/auth/error
  conventions.
- **Telnyx** (`carrier/telnyx.py`): list recent messages via the Telnyx v2 API — check the
  docs for the current endpoint (Messages list / MDR detail records; pick whichever supports
  a time filter with a plain API key) and map to `ProviderMessageRecord` (`message_sid` =
  Telnyx message id, same id the webhooks deliver). **Sandbox** (`TELNYX_SANDBOX=1`) has no
  real records: return `[]` and log a DEBUG line, mirroring however the file already
  branches on sandbox mode.
- If either API turns out not to support a usable time filter, filter client-side over the
  most recent page(s) and cap pages — note the cap in a comment. Don't build pagination
  crawlers.

## Part B — `app/services/reconciliation.py`

One cron function, e.g. `reconcile_provider_records(ctx)`:

1. Gate: return immediately unless `settings.reconciliation_enabled`.
2. Window: `since = now - reconciliation_lookback_minutes`; ignore provider records newer
   than a 5-minute grace cutoff (webhook may legitimately still be in flight).
3. Fetch `list_recent_calls(since)` / `list_recent_messages(since)`; for each, check
   existence locally by sid — `CallEventRepo.get_by_call_sid` exists; add a
   `SmsMessageRepo` equivalent if missing (check `app/repositories/sms_message_repo.py`
   first). For the calls diff, prefer one `SELECT call_sid WHERE call_sid IN (...)` batch
   (add a small repo method) over N queries.
4. For each missing record, log at **ERROR** (this is the alarm an agent greps for —
   stable, greppable prefix):

   ```python
   logger.error(
       "Reconciliation: provider call %s (%s -> %s, started %s, status %s) has no call_events row",
       rec.call_sid,
       rec.from_number,
       rec.to_number,
       rec.started_at,
       rec.status,
   )
   ```

5. Log an INFO summary line (counts checked/missing) per run only when something was
   fetched; stay silent on empty windows to avoid log noise.
6. **Do not** auto-insert missing rows. Detection only — backfill would guess at fields
   the webhook carries, and a synthesized row would mask that delivery is broken. (If
   backfill is ever wanted, it's a separate decision — leave a `TODO(#<issue>)` only if an
   issue exists; the tracker-ID rule forbids bare TODOs.)

Registration: add `cron(reconcile_provider_records, minute=<every 10 min set>, second=0)`
to `WorkerSettings.cron_jobs` in `call_sync.py`, and give the function its provider
instances via the same startup-hook pattern as `agent_status_sync`.

Config (`app/core/config.py` + `.env.example`): `reconciliation_enabled: bool = False`,
`reconciliation_lookback_minutes: int = 60`. Default-off because it needs live provider
credentials; the E2E/live environment turns it on.

## Tests (same commit)

`tests/unit/test_reconciliation.py`, mocking both providers at the Protocol boundary
(plain `AsyncMock` objects with the two methods; follow `tests/unit/test_call_sync.py`
fixtures for session/repo setup — respect the DB isolation rules in `tests/CLAUDE.md`):

- disabled flag → providers never called
- provider record with matching local row → no ERROR logged
- provider record missing locally → exactly one ERROR with the sid in the message (`caplog`)
- record inside the 5-min grace window → skipped
- SMS diff mirrors the same three cases
- provider raising → logged via `logger.exception`, cron returns without crashing
  (never let one provider's failure kill the other's diff — wrap each side separately)

Plus provider-implementation tests in the existing per-provider test modules (mock the
HTTP layer the same way neighboring methods' tests do; sandbox returns `[]`).

## Verify

```sh
pytest tests/unit/test_reconciliation.py tests/unit/test_call_sync.py <provider test modules>
ruff check app/services/reconciliation.py app/services/providers/ tests/unit/test_reconciliation.py
mypy app/services/reconciliation.py app/services/providers/
```

Live verification belongs to phase 05 (kill ngrok mid-test, watch the ERROR appear on the
next cron run).
