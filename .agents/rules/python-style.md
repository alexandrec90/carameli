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

## Imports and Module Structure

- Keep routers, schemas, models, repositories, services, and core configuration
  modules in their dedicated folders, following the project layout documented in
  `CLAUDE.md`.

## Audit Guardrails (Design-Flaws)

- Files over 300 lines (Py) / 250 lines (TSX) must be split before commit.
- Shared literals live in `frontend/src/lib/constants.ts` / `app/core/constants.py`. Never duplicate.
- Shared Python helpers live under `app/core/`. Do not redefine helpers like
  `format_date`, `format_phone`, `to_e164`, or `normalize_*` in schema/service files.
- TODO comments must reference a tracker ID (for example `TODO(#123): ...`).
- No relative imports beyond one parent (`from ..foo`). Use absolute imports rooted at `app.` where practical.
