from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope
from app.models.customer import Customer
from app.services import customer_service

logger = logging.getLogger(__name__)


async def resolve_customer(
    session: AsyncSession,
    auth: AuthContext,
    vs_customer_id: int | None,
) -> Customer:
    """Resolve the customer a native REST request operates on.

    A customer-scoped token already names its customer, so the body/query field is
    optional and, when present, must match it. An admin token names no customer of its
    own and therefore has to supply one.
    """
    target = vs_customer_id if vs_customer_id is not None else auth.vs_customer_id
    if target is None:
        raise HTTPException(
            status_code=400,
            detail="vs_customer_id is required when authenticating with an admin token",
        )
    enforce_customer_scope(auth, target)
    customer = await customer_service.get_by_vs_id(session, target)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", target)
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


def enforce_resource_scope(auth: AuthContext, owner_customer_id: uuid.UUID) -> None:
    """Reject an id-addressed resource that belongs to a different tenant.

    403 rather than 404, matching `enforce_customer_scope`: resource ids are UUIDs, so
    there is no enumeration to hide, and a single denial code keeps the two scoping
    paths reading the same way.
    """
    if auth.is_admin:
        return
    if auth.customer_id != owner_customer_id:
        raise HTTPException(status_code=403, detail="Forbidden for this customer")
