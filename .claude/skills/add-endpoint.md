# Skill: Add a VoiceGateway API Endpoint

Use this skill when adding a new route. Work through each step in order.

## Step 1 — Define the Contract

Answer these before writing any code:

- What is the exact HTTP method and path?
  (e.g., `PUT /vsapi/1.0.0/PhoneLine/UpdateCallRecording`)
- What does the request body / query params look like?
- What should the response JSON contain, and what are the exact field names?
- Is this route under `/vsapi/1.0.0/` (standard) or `/vg/1.0.0/` (VoiceGateway-native extension)?

## Step 2 — Add Pydantic Schemas

File: `app/schemas/<domain>.py`

- Add a request model (`class UpdateCallRecordingRequest(BaseModel): ...`)
- Add a response model if the route returns a body

## Step 3 — Add the Route Handler

File: `app/api/vsapi/<domain>.py`

```python
@router.put("/UpdateCallRecording")
async def update_call_recording(
    body: UpdateCallRecordingRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(verify_api_key)],
) -> UpdateCallRecordingResponse:
    """Toggle call recording on a DID."""
    return await phone_line_service.update_recording(session, body)
```

Keep the handler under ~15 lines; delegate to the service layer.

## Step 4 — Implement the Service Method

File: `app/services/twilio_provider.py` (for Twilio ops)
or `app/services/<domain>_service.py` (for pure logic)

- `async def` only
- Wrap Twilio SDK calls in `try/except TwilioRestException`
- Log and re-raise Twilio errors as `HTTPException(502)`

## Step 5 — Implement the Repository Method (if DB access needed)

File: `app/repositories/<domain>_repo.py`

- Accept `session: AsyncSession`
- Use SQLAlchemy ORM select/update — no raw SQL strings
- Commit inside the method

## Step 6 — Write Tests

Unit test (`tests/unit/test_<domain>.py`):
- Mock `twilio_provider` at the service boundary
- Test the handler logic, auth, and error paths

Integration test (`tests/integration/test_<domain>.py`):
- Use Twilio test credentials
- Hit the actual endpoint via `httpx.AsyncClient`

## Step 7 — Verify OpenAPI Docs

Run `docker compose up` and open `http://localhost:8000/docs`. Confirm the
new route appears with correct method, path, and schema.
