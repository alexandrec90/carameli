# Backend

Use async I/O, typed function signatures, and Pydantic request/response
models. Route handlers own HTTP concerns; services own workflows; repositories own ORM
operations and commits. Use `AsyncSession` from `get_session` in requests and
`async_session_factory` in ARQ jobs.

## Persistence

- Import every ORM model from `app/models/__init__.py` so Alembic sees it.
- Use UUID primary keys and server-side timestamps consistent with existing models.
- Customer-owned tables require an indexed `customer_id` foreign key.
- Never hard-delete customers, phone lines, or extensions. Retention jobs may delete
  call/SMS history only according to the configured retention policy.
- Use SQLAlchemy expressions, not raw SQL, unless the migration or query genuinely
  requires database-specific syntax.
- Migration filenames/revisions follow the existing zero-padded sequence. Review
  autogeneration, include a real downgrade, and never rewrite an applied migration.

## Boundaries

- Python/ORM fields are `snake_case`; preserve external JSON contracts at the schema
  edge rather than silently renaming fields.
- Use `httpx.AsyncClient`, `asyncio.sleep`, and async provider/database APIs inside
  async code.
- Translate expected client failures to explicit 4xx responses and provider failures
  to a stable API response at the handler boundary.

## Logging

Use a module-level `logging.getLogger(__name__)` and lazy `%s` arguments. Log stable
identifiers and outcomes, not secrets or raw PII. The root configuration already sends
records to the console and `logs/runtime/carameli.log`; do not add handlers or files in
feature modules.
