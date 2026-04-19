---
name: add-db-model
description: 'Adds a SQLAlchemy model and Alembic migration with repository and schema guidance. Use when introducing a new table or adding/changing columns in an existing one.'
argument-hint: 'Optional entity name or table (e.g., "call_event")'
---

# Skill: Add a Database Model + Migration

Use this skill when introducing a new table or adding columns to an existing one.

## Step 1 — Define the ORM Model

File: `app/models/<name>.py`

```python
from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class MyEntity(Base):
    __tablename__ = "my_entities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default=text("gen_random_uuid()")
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(
        server_default=text("now()"), onupdate=text("now()")
    )
```

Then add the import to `app/models/__init__.py`:

```python
from app.models.my_entity import MyEntity  # noqa: F401
```

## Step 2 — Generate the Migration

Ask the user to run:
`docker compose exec app alembic revision --autogenerate -m "add my_entities table"`

Open the generated file in `alembic/versions/` and verify:

- All columns are present with correct types
- Foreign keys have the right `ondelete` behaviour
- Any needed indexes are included (autogenerate misses multi-column indexes)
- `gen_random_uuid()` default is preserved (autogenerate sometimes drops it)

## Step 3 — Apply the Migration

Ask the user to run:
`docker compose exec app alembic upgrade head`

To roll back one step during development:
`docker compose exec app alembic downgrade -1`

## Step 4 — Add Pydantic Schemas

File: `app/schemas/<name>.py`

- `CreateMyEntityRequest` — fields accepted from the API client
- `MyEntityResponse` — fields returned in the response

## Step 5 — Create the Repository

File: `app/repositories/<name>_repo.py`

```python
class MyEntityRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, entity_id: uuid.UUID) -> MyEntity | None:
        result = await self.session.execute(
            select(MyEntity).where(MyEntity.id == entity_id)
        )
        return result.scalar_one_or_none()

    async def create(self, **kwargs) -> MyEntity:
        entity = MyEntity(**kwargs)
        self.session.add(entity)
        await self.session.commit()
        await self.session.refresh(entity)
        return entity
```

## Step 6 — Write Repository Tests

Write tests in `tests/unit/test_<name>_repo.py` against a real test database (separate from the dev DB).

## Checklist

- [ ] ORM model created in `app/models/<name>.py`
- [ ] Model imported in `app/models/__init__.py`
- [ ] Alembic migration generated and reviewed
- [ ] Migration applied successfully
- [ ] Pydantic schemas added in `app/schemas/<name>.py`
- [ ] Repository created in `app/repositories/<name>_repo.py`
- [ ] Repository tests written and passing
