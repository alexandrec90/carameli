from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.schemas.customer import CustomerCreate, CustomerIdResponse, CustomerResponse
from app.schemas.phone_line import PhoneLineResponse

router = APIRouter(prefix="/VsCustomer", tags=["customers"])


@router.post("/Create", status_code=201, response_model=CustomerResponse)
async def create_customer(
    body: CustomerCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> CustomerResponse:
    """Create a new customer record in VoiceGateway."""
    repo = CustomerRepo(session)
    customer = await repo.create(body)
    return CustomerResponse.model_validate(customer)


@router.get("/Get/{customerId}", response_model=CustomerResponse)
async def get_customer(
    customerId: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> CustomerResponse:
    """Return stored customer info by VanillaSoft customer ID."""
    repo = CustomerRepo(session)
    customer = await repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.get("/GetCustid/{customerId}", response_model=CustomerIdResponse)
async def get_customer_id(
    customerId: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> CustomerIdResponse:
    """Return VoiceGateway's internal customer UUID for a VanillaSoft customer ID."""
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
    _: Annotated[str, Depends(verify_api_key)],
) -> List[PhoneLineResponse]:
    """Return all active DIDs for the customer."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(customerId)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    line_repo = PhoneLineRepo(session)
    lines = await line_repo.get_all_for_customer(customer.id)
    return [PhoneLineResponse.model_validate(line) for line in lines]
