from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.agent import (
    AddAgentRequest,
    AgentListResponse,
    AgentResponse,
)
from app.services import agent_service, customer_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsAgent", tags=["agents"])


@router.get(
    "/List/{customerId}",
    response_model=AgentListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_agents(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentListResponse:
    """List a customer's configured agents, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing agents vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    agents = await agent_service.list_for_customer(session, customer.id)
    return AgentListResponse(
        agents=[AgentResponse.model_validate(a) for a in agents],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=AgentResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_agent(
    body: AddAgentRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentResponse:
    """Create a contact-centre agent configuration."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding agent vs_customer_id=%s name=%s extension_id=%s",
        body.vs_customer_id,
        body.name,
        body.extension_id,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    agent = await agent_service.create(
        session,
        customer_id=customer.id,
        name=body.name,
        extension_id=body.extension_id,
        status=body.status,
    )
    logger.info("Agent created id=%s vs_customer_id=%s", agent.id, body.vs_customer_id)
    return AgentResponse.model_validate(agent)


@router.put(
    "/Deactivate/{customerId}/{agentId}",
    response_model=AgentResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_agent(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    agentId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentResponse:
    """Soft-delete a customer's agent configuration."""
    enforce_customer_scope(auth, customerId)
    logger.info("Deactivating agent vs_customer_id=%s agent_id=%s", customerId, agentId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    agent = await agent_service.get_for_customer(session, agentId, customer.id)
    if not agent:
        logger.warning("Agent not found vs_customer_id=%s agent_id=%s", customerId, agentId)
        raise HTTPException(status_code=404, detail="Agent not found")
    agent = await agent_service.deactivate(session, agent)
    return AgentResponse.model_validate(agent)
