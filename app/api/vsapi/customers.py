from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    AuthContext,
    enforce_customer_scope,
    get_auth_context,
    verify_api_key,
)
from app.core.database import get_session
from app.schemas.customer import (
    CustomerCreate,
    CustomerCreateResponse,
    CustomerIdResponse,
    CustomerResponse,
)
from app.schemas.phone_line import PhoneLineResponse
from app.services import customer_service, phone_line_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/VsCustomer", tags=["customers"])


@router.post(
    "/Add",
    status_code=201,
    response_model=CustomerCreateResponse,
    responses={
        400: {"description": "Invalid request body"},
        409: {"description": "Customer already exists"},
    },
)
@router.post(
    "/Create",
    status_code=201,
    response_model=CustomerCreateResponse,
    responses={
        400: {"description": "Invalid request body"},
        409: {"description": "Customer already exists"},
    },
)
async def create_customer(
    body: CustomerCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> CustomerCreateResponse:
    """Create a new customer record in Carameli.

    No carrier or engine resources are provisioned here.

    Investigation (CmvCustomer.cs -> CreateAccount): LegacyCRM's CMVClient.CreateAccount()
    POSTs a ContactInfoVS payload to the legacy the legacy VoIP vendor VsCustomer/Add endpoint. ``/Add``
    and Carameli's clearer ``/Create`` route therefore share this handler. The .cs file is
    a thin HTTP client wrapper — it does not
    call Telnyx, Jambonz, or any other provider directly. There are no durable carrier
    resources (SIP credentials, sub-accounts) created per-customer in the LegacyCRM flow,
    so no provider calls are needed here beyond the DB insert.
    """
    logger.info("Creating customer vs_customer_id=%s", body.vs_customer_id)
    try:
        customer = await customer_service.create(session, body)
    except IntegrityError:
        await session.rollback()
        logger.warning(
            "Customer already exists or API key conflict vs_customer_id=%s",
            body.vs_customer_id,
        )
        raise HTTPException(status_code=409, detail="Customer already exists") from None
    logger.info("Customer created id=%s vs_customer_id=%s", customer.id, customer.vs_customer_id)
    return CustomerCreateResponse.model_validate(customer)


@router.get(
    "/Get/{customerId}",
    response_model=CustomerResponse,
    responses={404: {"description": "Customer not found"}},
)
async def get_customer(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CustomerResponse:
    """Return stored customer info by CRM customer ID."""
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", customerId)
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.get(
    "/GetCustid/{customerId}",
    response_model=CustomerIdResponse,
    responses={404: {"description": "Customer not found"}},
)
async def get_customer_id(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> CustomerIdResponse:
    """Return Carameli's internal customer UUID for a CRM customer ID."""
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerIdResponse(internal_id=customer.id, vs_customer_id=customer.vs_customer_id)


@router.get(
    "/GetPhoneLines/{customerId}",
    response_model=list[PhoneLineResponse],
    responses={404: {"description": "Customer not found"}},
)
async def get_customer_phone_lines(
    customerId: Annotated[int, Path(ge=1, le=2147483647)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> list[PhoneLineResponse]:
    """Return all active DIDs for the customer."""
    enforce_customer_scope(auth, customerId)
    customer = await customer_service.get_by_vs_id(session, customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    lines = await phone_line_service.get_all_for_customer(session, customer.id)
    return [PhoneLineResponse.model_validate(line) for line in lines]
