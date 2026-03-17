"""
Template: SQLAlchemy ORM model.

Steps:
  1. Rename MyEntity → your class name (PascalCase).
  2. Rename "my_entities" → your table name (snake_case plural).
  3. Replace the TODO columns with your domain fields.
  4. Add the import to app/models/__init__.py:
       from app.models.my_entity import MyEntity  # noqa: F401
  5. Run: docker compose exec app alembic revision --autogenerate -m "add my_entities"
  6. Review the generated migration (check gen_random_uuid, foreign keys, indexes).
  7. Run: docker compose exec app alembic upgrade head
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class MyEntity(Base):  # TODO: rename
    __tablename__ = "my_entities"  # TODO: rename

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # TODO: add domain columns here.
    # Examples:
    #   name: Mapped[str] = mapped_column(String(255), nullable=False)
    #   external_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    #   customer_id: Mapped[uuid.UUID] = mapped_column(
    #       UUID(as_uuid=True),
    #       ForeignKey("customers.id", ondelete="CASCADE"),
    #       nullable=False,
    #   )

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<MyEntity id={self.id}>"
