from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.repositories.agent_status_repo import AgentStatusRepo
from app.repositories.customer_repo import CustomerRepo
from app.schemas.agent_status import AgentStatusResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/AgentStatus", tags=["agent-status"])


@router.get(
    "/{customerId}",
    response_model=list[AgentStatusResponse],
    responses={
        404: {"description": "Customer not found"},
    },
)
async def get_agent_status(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    customerId: int = Path(ge=1, le=2147483647),
) -> list[AgentStatusResponse]:
    """Return the latest polled presence snapshot for every agent belonging to a customer."""
    enforce_customer_scope(auth, customerId)
    logger.info("get_agent_status vs_customer_id=%s", customerId)

    customer = await CustomerRepo(session).get_by_vs_id(customerId)
    if not customer:
        logger.warning("get_agent_status customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")

    rows = await AgentStatusRepo(session).get_for_customer(customer.id)
    logger.info("get_agent_status vs_customer_id=%s returning %d rows", customerId, len(rows))
    return [AgentStatusResponse.model_validate(r) for r in rows]
