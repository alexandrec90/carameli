---
description: Python and FastAPI coding style conventions
paths:
  - app/**/*.py
  - tests/**/*.py
  - alembic/**/*.py
---

# Rule: Python / FastAPI Code Style

## General

- Target **Python 3.12**. Use `from __future__ import annotations` in all modules.
- Type-annotate every function signature — parameters and return types.
- Prefer `async def` for all route handlers and anything that touches the DB or
  provider clients.
- Keep route handlers thin (≤ ~15 lines). Delegate logic to the service or
  repository layer.
- No raw dicts returned from routes — always return a typed Pydantic response model.

## FastAPI Patterns

- Use `Annotated[..., Depends(...)]` for dependency injection (not the older
  `param: Type = Depends(...)` form).
- Define request bodies as Pydantic `BaseModel` subclasses in `app/schemas/`.
- Group related routes into `APIRouter` instances in their own files; include
  them in `app/api/vsapi/__init__.py` with the correct prefix.
- Decorate with explicit `status_code` where it differs from 200:
  `@router.post("/Add", status_code=201)`.
- Add a one-line docstring to each route handler — FastAPI surfaces it in the
  auto-generated OpenAPI docs.

## Error Handling

- Raise `HTTPException` for client errors (4xx). Include a descriptive `detail`.
- Provider errors caught in the service layer should be logged then re-raised as
  `HTTPException(status_code=502, detail="Provider error")`.
- Never let unhandled exceptions reach VanillaSoft without a meaningful HTTP
  status code.

## Async / Concurrency

- Use `httpx.AsyncClient` for outbound HTTP — never `requests` inside an async
  route.
- Use `asyncio.sleep` — never `time.sleep` inside async code.
- Repository functions always accept `session: AsyncSession` and commit
  internally; callers do not manage transactions directly.

## Logging

- Every module that emits log output must declare its logger at **module scope**:

      import logging
      logger = logging.getLogger(__name__)

- Never instantiate a logger inside a function or route handler.
- Use `%s`-style lazy formatting — never f-strings inside `logger.*()` calls:

      # correct
      logger.info("Phone line added number=%s sid=%s", line.phone_number, line.provider_sid)
      # wrong
      logger.info(f"Phone line added number={line.phone_number}")

  - In every route handler log: entry at `INFO`, 404/409 at `WARNING`, provider/5xx errors at `ERROR`.
  - Never log secrets: no `api_key`, provider credentials, or SIP passwords.
- Full spec: `.claude/rules/logging.md`.

## Imports and Module Structure

- Keep routers, schemas, models, repositories, services, and core configuration
  modules in their dedicated folders, following the project layout documented in
  `CLAUDE.md`.
