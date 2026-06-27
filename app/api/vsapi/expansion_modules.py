from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.database import get_session
from app.schemas.expansion_module import (
    AddExpansionModuleRequest,
    ExpansionModuleListResponse,
    ExpansionModuleResponse,
)
from app.services import customer_service, expansion_module_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsExpansionModule", tags=["expansion-modules"])


@router.get(
    "/List/{customerId}",
    response_model=ExpansionModuleListResponse,
    responses={404: {"description": "Customer not found"}},
)
async def list_expansion_modules(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExpansionModuleListResponse:
    """List a customer's expansion modules, newest first."""
    enforce_customer_scope(auth, customerId)
    logger.info("Listing expansion modules vs_customer_id=%s", customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    modules = await expansion_module_service.list_for_customer(session, customer.id)
    return ExpansionModuleListResponse(
        expansion_modules=[ExpansionModuleResponse.model_validate(m) for m in modules],
        vs_customer_id=customerId,
    )


@router.post(
    "/Add",
    status_code=201,
    response_model=ExpansionModuleResponse,
    responses={
        400: {"description": "Invalid request body"},
        404: {"description": "Customer not found"},
    },
)
async def add_expansion_module(
    body: AddExpansionModuleRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExpansionModuleResponse:
    """Register a receptionist expansion module."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Adding expansion module vs_customer_id=%s brand=%s model=%s",
        body.vs_customer_id,
        body.brand,
        body.model,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")
    em = await expansion_module_service.create(
        session,
        customer_id=customer.id,
        description=body.description,
        brand=body.brand,
        model=body.model,
    )
    logger.info("Expansion module created id=%s vs_customer_id=%s", em.id, body.vs_customer_id)
    return ExpansionModuleResponse.model_validate(em)


@router.put(
    "/Deactivate/{customerId}/{moduleId}",
    response_model=ExpansionModuleResponse,
    responses={404: {"description": "Not found"}},
)
async def deactivate_expansion_module(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    moduleId: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExpansionModuleResponse:
    """Soft-delete an expansion module."""
    enforce_customer_scope(auth, customerId)
    logger.info(
        "Deactivating expansion module vs_customer_id=%s module_id=%s",
        customerId,
        moduleId,
    )
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    em = await expansion_module_service.get_for_customer(session, moduleId, customer.id)
    if not em:
        logger.warning(
            "Expansion module not found vs_customer_id=%s module_id=%s",
            customerId,
            moduleId,
        )
        raise HTTPException(status_code=404, detail="Expansion module not found")
    em = await expansion_module_service.deactivate(session, em)
    return ExpansionModuleResponse.model_validate(em)
