from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.agent_skill import (
    AddAgentSkillRequest,
    AgentSkillListResponse,
    AgentSkillResponse,
)
from app.services import agent_service, agent_skill_service, customer_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsAgentSkill", tags=["agent-skills"])


@router.get(
    "/List/{customerId}",
    response_model=AgentSkillListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_agent_skills(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentSkillListResponse:
    """List all agent skills for a customer, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing agent skills vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    skills = await agent_skill_service.list_for_customer(session, customer.id)
    return AgentSkillListResponse(
        agent_skills=[AgentSkillResponse.model_validate(s) for s in skills],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=AgentSkillResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer or agent not found"},
    },
)
async def add_agent_skill(
    body: AddAgentSkillRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentSkillResponse:
    """Add a skill to a contact-centre agent."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding agent skill vs_customer_id=%s agent_id=%s skill=%s level=%s",
        body.vs_customer_id,
        body.agent_id,
        body.skill,
        body.level,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    agent = await agent_service.get_for_customer(session, body.agent_id, customer.id)
    if not agent:
        logger.warning(
            "Agent not found vs_customer_id=%s agent_id=%s",
            body.vs_customer_id,
            body.agent_id,
        )
        raise HTTPException(status_code=404, detail="Agent not found")
    skill = await agent_skill_service.create(
        session,
        customer_id=customer.id,
        agent_id=agent.id,
        skill=body.skill,
        level=body.level,
    )
    logger.info(
        "Agent skill created id=%s vs_customer_id=%s agent_id=%s",
        skill.id,
        body.vs_customer_id,
        body.agent_id,
    )
    return AgentSkillResponse.model_validate(skill)


@router.put(
    "/Deactivate/{customerId}/{skillId}",
    response_model=AgentSkillResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_agent_skill(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    skillId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> AgentSkillResponse:
    """Soft-delete an agent skill record."""
    enforce_customer_scope(auth, customerId)
    logger.info("Deactivating agent skill vs_customer_id=%s skill_id=%s", customerId, skillId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    skill = await agent_skill_service.get_for_customer(session, skillId, customer.id)
    if not skill:
        logger.warning("Agent skill not found vs_customer_id=%s skill_id=%s", customerId, skillId)
        raise HTTPException(status_code=404, detail="Agent skill not found")
    skill = await agent_skill_service.deactivate(session, skill)
    return AgentSkillResponse.model_validate(skill)
