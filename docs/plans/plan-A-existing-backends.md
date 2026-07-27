# Plan A — Surface Existing Backend Data (SMS History)

## Summary

The `sms_messages` table is already populated on every send/receive
(`app/services/sms_message_service.py`), but the `/sms` route is a static placeholder.
Add a customer-scoped list endpoint and turn `/sms` into a functional `DataPage` (search +
date range + table + CSV export) exactly like the Phase 0 Call Events vertical. This is the
last page whose data already persists with no new model — everything else is in Plan B.

**Pattern reference:** the Call Events vertical, end to end:
`app/api/vsapi/calls.py:110` (route), `app/repositories/call_event_repo.py::list_for_customer`,
`frontend/src/hooks/useCallEvents.ts`, `frontend/src/pages/CallEvents.tsx`,
`tests/unit/test_calls.py`, `frontend/src/tests/useCallEvents.test.ts`.

## Open questions

None. (Outbound-send UI is intentionally out of scope — this page is read/history first.
The existing `POST /VsMessaging/Sms/Send/{customerId}` can be wired as a `DataPage` action
in a follow-up.)

## Changes

### 1. `app/repositories/sms_message_repo.py`

**Location:** add a method after `get_by_message_sid` (line 49).

**Change:** mirror `CallEventRepo.list_for_customer`, but filter/order on `created_at`
(SmsMessage has no `started_at`):

```python
async def list_for_customer(
    self,
    customer_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
) -> list[SmsMessage]:
    stmt = select(SmsMessage).where(SmsMessage.customer_id == customer_id)
    if start is not None:
        stmt = stmt.where(SmsMessage.created_at >= start)
    if end is not None:
        stmt = stmt.where(SmsMessage.created_at <= end)
    stmt = stmt.order_by(SmsMessage.created_at.desc()).limit(limit)
    result = await self.session.execute(stmt)
    return list(result.scalars().all())
```

Add `from datetime import datetime` to the imports.

**Why:** read-side query the new endpoint needs; mirrors the call-event repo.

**Verify:** `docker compose exec -T app pytest tests/unit/test_sms.py -q`

### 2. `app/services/sms_message_service.py`

**Location:** add a top-level async function (after the imports / before `create_outbound`).

**Change:**

```python
async def list_for_customer(
    session: AsyncSession,
    customer_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
) -> list[SmsMessage]:
    return await SmsMessageRepo(session).list_for_customer(customer_id, start, end, limit)
```

Add `from datetime import datetime` import.

**Why:** thin service wrapper per `app/services/CLAUDE.md`.

**Verify:** same as #1.

### 3. `app/schemas/sms.py`

**Location:** append after `SmsEnableDisableResponse` (line 22+).

**Change:**

```python
class SmsMessageResponse(BaseModel):
    id: uuid.UUID
    direction: str
    from_number: str
    to_number: str
    body: str
    message_sid: str | None
    delivery_status: str | None
    error_code: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SmsMessageListResponse(BaseModel):
    messages: list[SmsMessageResponse]
    vs_customer_id: int
```

Add `import uuid` and `from datetime import datetime` if not already imported.

**Why:** typed response models (no raw dicts) per `.claude/rules/python-style.md`. Mirrors
`app/schemas/call_event.py::CallEventResponse` / `CallEventListResponse`.

**Verify:** `docker compose exec -T app python -m py_compile app/schemas/sms.py`

### 4. `app/api/vsapi/sms.py`

**Location:** new route handler at the end of the file (router prefix is `/VsMessaging/Sms`).

**Change:** mirror `app/api/vsapi/calls.py::list_call_events` (line 110). Import additions:
`from datetime import datetime`, `Query` into the existing fastapi import,
`sms_message_service` into the existing `from app.services import ...`, and the two new
schemas.

```python
@router.get(
    "/List/{customerId}",
    response_model=SmsMessageListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_sms_messages(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    start: Annotated[datetime | None, Query()] = None,
    end: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> SmsMessageListResponse:
    """List a customer's SMS messages, newest first, with an optional created_at date range."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing SMS messages vs_customer_id=%s start=%s end=%s", customerId, start, end)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    messages = await sms_message_service.list_for_customer(session, customer.id, start, end, limit)
    return SmsMessageListResponse(
        messages=[SmsMessageResponse.model_validate(m) for m in messages],
        vs_customer_id=customerId,
    )
```

**Why:** the read endpoint the front-end calls; customer-scoped per `.claude/rules/security.md`.

**Verify:** `docker compose exec -T app pytest tests/unit/test_sms.py -q`

### 5. `tests/unit/test_sms.py`

**Location:** add tests at the end.

**Change:** mirror the 5 list tests added in `tests/unit/test_calls.py` (the
`test_list_call_events_*` block: returns events, empty, isolated-per-customer, date-range
filters, customer-not-found). Use `SmsMessageRepo(db_session).create(...)` to seed instead
of the webhook helper — e.g.:

```python
await SmsMessageRepo(db_session).create(
    customer_id=customer_id,
    phone_line_id=None,
    message_sid="SMtest1",
    direction="outbound",
    from_number="+14155550000",
    to_number="+14155550001",
    body="hi",
    delivery_status="delivered",
)
```

Then `GET /vsapi/1.0.0/VsMessaging/Sms/List/{vs_id}` and assert on `["messages"]`.

**Why:** test-in-same-commit mandate; `tests/unit/test_calls.py` is the exact template.

**Verify:** `docker compose exec -T app pytest tests/unit/test_sms.py -q` (all green)

### 6. `frontend/src/api/client.ts`

**Location:** add an `sms` group to the `api` object (after `calls`) and types after
`CallEventListResponse`.

**Change:** mirror the `calls.list` block:

```ts
sms: {
  list: (
    customerId: number,
    params: { start?: string; end?: string; limit?: number } = {}
  ) => {
    const q = new URLSearchParams()
    if (params.start) q.set('start', params.start)
    if (params.end) q.set('end', params.end)
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return request<SmsMessageListResponse>(
      `/vsapi/1.0.0/VsMessaging/Sms/List/${customerId}${qs ? `?${qs}` : ''}`
    )
  },
},
```

```ts
export interface SmsMessage {
  id: string
  direction: string
  from_number: string
  to_number: string
  body: string
  message_sid: string | null
  delivery_status: string | null
  error_code: string | null
  created_at: string
}
export interface SmsMessageListResponse {
  messages: SmsMessage[]
  vs_customer_id: number
}
```

**Why:** typed client call, mirrors `calls.list`.

**Verify:** `docker compose exec -T frontend sh -c "cd /app && npx tsc --noEmit"`

### 7. `frontend/src/hooks/useSms.ts` (new)

**Location:** new file.

**Change:** copy `frontend/src/hooks/useCallEvents.ts` and adapt: import `api`/`SmsMessage`,
columns `[created_at→Date, direction→Direction, from_number→From, to_number→To, body→Message,
delivery_status→Status]`, `toRow` maps those fields (format `created_at` with the same
`fmtDateTime`), title `'SMS'`, description `'Send and review SMS messages via the active carrier'`,
call `api.sms.list(...)`, export filename `sms-messages.csv`, log route `'/sms'`.

**Why:** owns logic + returns `DataPageProps`; mirrors `useCallEvents`. Descriptor types come
from `../lib/dataPage` (never `skins/`).

**Verify:** tsc + the hook test (#9).

### 8. `frontend/src/pages/Sms.tsx`

**Location:** whole file (currently the static placeholder).

**Change:**

```tsx
import { useSms } from '../hooks/useSms'
import { useSkin } from '../skins/context'

export default function Sms() {
  const data = useSms()
  const { views } = useSkin()
  return <views.DataPage {...data} />
}
```

**Why:** thin orchestrator per `.claude/rules/skin-architecture.md`; turns the placeholder
functional across all skins.

**Verify:** `docker compose exec -T frontend sh -c "cd /app && npx eslint src/pages/Sms.tsx"`

### 9. `frontend/src/tests/useSms.test.ts` (new)

**Location:** new file.

**Change:** copy `frontend/src/tests/useCallEvents.test.ts`, swap the mock to `api.sms.list`,
adjust `makeEvent`→`makeMessage` fields and the assertions (e.g. `row.created_at`,
`row.direction`, search across `body`/numbers, date refetch arg shape `(1, { start, end, limit })`).

**Why:** test-in-same-commit; exact template exists.

**Verify:** `docker compose exec -T frontend sh -c "cd /app && npx vitest run src/tests/useSms.test.ts"`

## Done criteria

- `pytest tests/unit/test_sms.py` green; `ruff`/`mypy`/`py_compile` clean on the 4 backend files.
- `tsc --noEmit` clean; `vitest run src/tests/useSms.test.ts` green; eslint clean.
- `/sms` renders a searchable, date-filterable SMS table in every skin.
