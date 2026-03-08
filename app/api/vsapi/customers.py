from __future__ import annotations

import logging
from typing import Annotated, List

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
from app.repositories.customer_repo import CustomerRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.customer import CustomerCreate, CustomerIdResponse, CustomerResponse
from app.schemas.phone_line import PhoneLineResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsCustomer", tags=["customers"])


@router.post("/Create", status_code=201, response_model=CustomerResponse)
async def create_customer(
    body: CustomerCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> CustomerResponse:
    """Create a new customer record in Carameli."""
    logger.info("Creating customer vs_customer_id=%s", body.vs_customer_id)
    repo = CustomerRepo(session)
    try:
        customer = await repo.create(body)
    except IntegrityError:
        await session.rollback()
        logger.warning(
            "Customer already exists or API key conflict vs_customer_id=%s",
            body.vs_customer_id,
        )
        raise HTTPException(status_code=409, detail="Customer already exists")
    logger.info(
        "Customer created id=%s vs_customer_id=%s", customer.id, customer.vs_customer_id
    )
    return CustomerResponse.model_validate(customer)


@router.get("/Get/{customerId}", response_model=CustomerResponse)
async def get_customer(
    customerId: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CustomerResponse:
    """Return stored customer info by VanillaSoft customer ID."""
    enforce_customer_scope(auth, customerId)
    repo = CustomerRepo(session)
    customer = await repo.get_by_vs_id(customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.get("/GetCustid/{customerId}", response_model=CustomerIdResponse)
async def get_customer_id(
    customerId: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CustomerIdResponse:
    """Return Carameli's internal customer UUID for a VanillaSoft customer ID."""
    enforce_customer_scope(auth, customerId)
    repo = CustomerRepo(session)
    customer = await repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerIdResponse(
        internal_id=customer.id, vs_customer_id=customer.vs_customer_id
    )


@router.get("/GetPhoneLines/{customerId}", response_model=List[PhoneLineResponse])
async def get_customer_phone_lines(
    customerId: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> List[PhoneLineResponse]:
    """Return all active DIDs for the customer."""
    enforce_customer_scope(auth, customerId)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    lines = await line_repo.get_all_for_customer(customer.id)
    return [PhoneLineResponse.model_validate(line) for line in lines]
