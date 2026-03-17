"""
Template: async SQLAlchemy repository.

File: app/repositories/my_entity_repo.py

Rules:
  - Accept session: AsyncSession in __init__ — never create your own session.
  - Use SQLAlchemy ORM select/update — no raw SQL strings.
  - Commit inside write methods; caller should not need to commit.
  - Filter by active=True on every read unless intentionally including inactive rows.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.my_entity import MyEntity  # TODO: update import
from app.schemas.my_entity import MyEntityCreate  # TODO: update import


class MyEntityRepo:  # TODO: rename
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, data: MyEntityCreate) -> MyEntity:
        entity = MyEntity(
            # TODO: map schema fields to model columns
            # name=data.name,
        )
        self.session.add(entity)
        await self.session.commit()
        await self.session.refresh(entity)
        return entity

    async def get_by_id(self, entity_id: uuid.UUID) -> MyEntity | None:
        result = await self.session.execute(
            select(MyEntity).where(
                MyEntity.id == entity_id,
                MyEntity.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[MyEntity]:
        result = await self.session.execute(select(MyEntity).where(MyEntity.active.is_(True)))
        return list(result.scalars().all())

    async def deactivate(self, entity_id: uuid.UUID) -> MyEntity | None:
        entity = await self.get_by_id(entity_id)
        if entity is None:
            return None
        entity.active = False
        await self.session.commit()
        await self.session.refresh(entity)
        return entity
