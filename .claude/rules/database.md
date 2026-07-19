---
description: Database / SQLAlchemy / Alembic conventions
paths:
  - app/models/**/*.py
  - app/repositories/**/*.py
  - app/core/database.py
  - app/schemas/**/*.py
  - alembic/**/*.py
---

# Rule: Database / SQLAlchemy / Alembic

## ORM Models (`app/models/`)

- All models live in `app/models/`. Import every model in `app/models/__init__.py`
  so Alembic autogenerate picks them up.
- Use **UUID primary keys**:

      id: Mapped[uuid.UUID] = mapped_column(
          UUID(as_uuid=True), primary_key=True,
          server_default=text("gen_random_uuid()")
      )

- Always include `created_at` and `updated_at` with server defaults:

      created_at: Mapped[datetime] = mapped_column(server_default=func.now())
      updated_at: Mapped[datetime] = mapped_column(
          server_default=func.now(), onupdate=func.now()
      )

- **Soft-delete** with `active: Mapped[bool] = mapped_column(default=True)`.
  Never hard-delete `customers`, `phone_lines`, or `extensions` rows.
  Hard-deletes are only acceptable for `call_events` and `sms_messages` rows
  older than the retention window.

- **`customer_id` FK columns must declare `index=True`** — every migration that
  creates a customer-scoped table also runs `op.create_index("ix_<table>_customer_id", ...)`.
  If the model column omits `index=True`, Alembic autogenerate sees the index in the DB
  but not in the model and generates a spurious `drop_index` operation (schema drift).
  This is the most common source of CI `alembic check` failures in this codebase.

      customer_id: Mapped[uuid.UUID] = mapped_column(
          UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False, index=True
      )

## Data Model Reference

Core tables from the PRD:

| Table | Key Columns |
| --- | --- |
| `customers` | `vs_customer_id`, `api_key`, `active` |
| `phone_lines` | `customer_id`, `phone_number` (E.164), `provider_sid`, `sms_enabled`, `recording_enabled` |
| `extensions` | `customer_id`, `extension_number`, `sip_username`, `sip_credential_sid`, `sip_domain_sid` |
| `sci_rules` | `customer_id`, `extension_id`, `zip_code`, `enabled` |
| `did_pointers` | `phone_line_id`, `extension_id` |
| `call_events` | `call_sid`, `direction`, `started_at`, `ended_at`, `duration_seconds`, `matched_at` |

## Migrations (Alembic)

- Always **review** the generated file — autogenerate misses some things (custom
  indexes, check constraints, `gen_random_uuid()` defaults).
- Never edit a migration that has already been applied to any non-local environment.
- Name migrations descriptively: the message becomes part of the filename.

## Repositories (`app/repositories/`)

- One repository class per major entity (e.g., `CustomerRepo`, `LineRepo`,
  `CallEventRepo`).
- Constructor accepts `session: AsyncSession`.
- No raw SQL strings unless absolutely necessary — use SQLAlchemy ORM / core
  select expressions.
- Repository methods handle commits; callers do not call `session.commit()`.

## Sessions

- Use `AsyncSession` everywhere (never the synchronous `Session`).
- Obtain sessions via the `get_session` FastAPI dependency from `app/core/database.py`.
- In APScheduler jobs, create a session manually using the `async_session_factory`.
