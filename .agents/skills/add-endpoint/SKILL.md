---
name: add-endpoint
disable-model-invocation: true
description: 'Adds a FastAPI route handler with Pydantic schemas, service wiring, and logging. Use when creating a new REST endpoint for the Carameli API.'
argument-hint: 'Optional endpoint name or route path (e.g., "/PhoneLine/UpdateCallRecording")'
---

# Skill: Add a Carameli API Endpoint

Use this skill when adding a new route. Work through each step in order.

## Step 1 — Define the Contract

Answer these before writing any code:

- What is the exact HTTP method and path?
  (e.g., `PUT /vsapi/1.0.0/PhoneLine/UpdateCallRecording`)
- What does the request body / query params look like?
- What should the response JSON contain, and what are the exact field names?
- Is this route under `/vsapi/1.0.0/` (standard) or `/vg/1.0.0/` (Carameli-native extension)?

## Step 2 — Add Pydantic Schemas

File: `app/schemas/<domain>.py`

- Add a request model (`class UpdateCallRecordingRequest(BaseModel): ...`)
- Add a response model if the route returns a body

## Step 3 — Add the Route Handler

File: `app/api/vsapi/<domain>.py`

Add `logger = logging.getLogger(__name__)` once at module scope (not inside the function), then log entry, warnings, and errors inside the handler:

```python
import logging
logger = logging.getLogger(__name__)

@router.put("/UpdateCallRecording")
async def update_call_recording(
    body: UpdateCallRecordingRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(verify_api_key)],
) -> UpdateCallRecordingResponse:
    """Toggle call recording on a DID."""
    logger.info("UpdateCallRecording vs_customer_id=%s number=%s enabled=%s",
                body.vs_customer_id, body.phone_number, body.enabled)
    # log WARNING before any 404/409 raise
    # log ERROR before any 502 raise
    logger.info("Recording updated number=%s", body.phone_number)
    return await phone_line_service.update_recording(session, body)
```

Keep the handler under ~15 lines; delegate to the service layer.
See `.claude/rules/logging.md` for the full logging convention.

## Step 4 — Implement the Service Method

File: `app/services/call_control.py` or `app/services/did_manager.py` (for VoIP ops)
or `app/services/<domain>_service.py` (for pure logic)

- `async def` only
- Accept a provider instance injected via FastAPI dependency — **never import a concrete provider directly**
- Wrap provider calls in `try/except` for the provider's exception type and re-raise as `HTTPException(502)`
- See `.claude/rules/voip-providers.md` for error handling conventions per provider

## Step 5 — Implement the Repository Method (if DB access needed)

File: `app/repositories/<domain>_repo.py`

- Accept `session: AsyncSession`
- Use SQLAlchemy ORM select/update — no raw SQL strings
- Commit inside the method

## Step 6 — Write Tests

Unit test (`tests/unit/test_<domain>.py`):

- Mock at the `CarrierProvider` / `CallEngineProvider` interface boundary — never mock internal SDK details
- Test the handler logic, auth, and error paths (including 502 on provider failure)

Integration test (`tests/integration/test_<domain>.py`):

- Use Telnyx sandbox credentials + local Jambonz
- Hit the actual endpoint via `httpx.AsyncClient`

## Step 7 — Verify OpenAPI Docs

Ask the user to confirm the new route appears with correct method, path, and schema at `http://localhost:8000/docs`.

## Checklist

- [ ] Contract defined (method, path, request/response shape)
- [ ] Pydantic schemas added in `app/schemas/<domain>.py`
- [ ] Route handler added with auth dependency and logging
- [ ] Service method implemented (async, provider-injected)
- [ ] Repository method added (if DB access needed)
- [ ] Unit + integration tests written
- [ ] New endpoint visible in OpenAPI docs
