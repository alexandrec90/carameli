"""
Template: FastAPI route handler.

File: app/api/vsapi/<domain>.py  (add to the matching domain file, or create one)

Rules enforced here:
  - logger declared at module scope, never inside a function.
  - Every handler logs entry at INFO; 404s at WARNING; 502s at ERROR.
  - Handler body ≤ ~15 lines — delegate logic to repo / service layer.
  - Auth via Depends(verify_api_key) for admin-only routes,
    or Depends(get_auth_context) + enforce_customer_scope() for customer-scoped ones.
    - Never catch bare Exception — catch specific errors (IntegrityError, provider SDK errors).

Steps:
  1. Rename MyDomain, MyEntityCreate, MyEntityResponse to your domain names.
  2. Choose the correct auth pattern (admin-only vs customer-scoped).
  3. Implement the service/repo call inside the handler body.
  4. Add the router to app/main.py if this is a new router file.
"""

from __future__ import annotations

import logging
from typing import Annotated

from app.repositories.my_entity_repo import MyEntityRepo  # TODO: update import
from app.schemas.my_entity import (
    MyEntityCreate,
    MyEntityResponse,
)

# TODO: update imports
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    AuthContext,
    enforce_customer_scope,
    get_auth_context,
    verify_api_key,
)
from app.core.database import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/MyDomain", tags=["my_domain"])  # TODO: rename


# ---------------------------------------------------------------------------
# Admin-only route example (uses verify_api_key)
# ---------------------------------------------------------------------------


@router.post("/Create", status_code=201, response_model=MyEntityResponse)
async def create_my_entity(
    body: MyEntityCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> MyEntityResponse:
    """Create a new MyEntity."""
    logger.info("Create MyEntity ...")  # TODO: log key identifiers from body
    repo = MyEntityRepo(session)
    try:
        entity = await repo.create(body)
    except IntegrityError:
        await session.rollback()
        logger.warning("MyEntity already exists ...")  # TODO: log identifier
        raise HTTPException(status_code=409, detail="Already exists") from None
    logger.info("MyEntity created id=%s", entity.id)
    return MyEntityResponse.model_validate(entity)


# ---------------------------------------------------------------------------
# Customer-scoped route example (uses get_auth_context + enforce_customer_scope)
# ---------------------------------------------------------------------------


@router.get("/Get/{customerId}/{entityId}", response_model=MyEntityResponse)
async def get_my_entity(
    customerId: int,
    entityId: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> MyEntityResponse:
    """Return a MyEntity by ID, scoped to the requesting customer."""
    enforce_customer_scope(auth, customerId)
    import uuid

    repo = MyEntityRepo(session)
    entity = await repo.get_by_id(uuid.UUID(entityId))
    if not entity:
        logger.warning("MyEntity not found id=%s", entityId)
        raise HTTPException(status_code=404, detail="Not found")
    return MyEntityResponse.model_validate(entity)
