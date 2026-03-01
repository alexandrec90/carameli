"""
Template: Pydantic request and response schemas.

File: app/schemas/my_entity.py

Steps:
  1. Rename MyEntity throughout to match your domain class name.
  2. Add fields that the API accepts in MyEntityCreate.
  3. Add fields that the API exposes in MyEntityResponse.
  4. Use model_config = {"from_attributes": True} on response models so
     SQLAlchemy ORM objects can be passed directly to model_validate().
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class MyEntityCreate(BaseModel):
    """Fields accepted from the API client when creating a MyEntity."""

    model_config = ConfigDict(extra="forbid")

    # TODO: replace with your domain fields
    # vs_customer_id: int
    # name: str

    @field_validator("*", mode="before")  # TODO: scope to string fields only if needed
    @classmethod
    def strip_strings(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class MyEntityUpdate(BaseModel):
    """Fields accepted when updating a MyEntity. All optional."""

    model_config = ConfigDict(extra="forbid")

    # TODO: add updatable fields, all Optional
    # name: str | None = None


class MyEntityResponse(BaseModel):
    """Fields returned in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    active: bool
    created_at: datetime

    # TODO: add domain fields that should be visible to callers
    # name: str
    # vs_customer_id: int
