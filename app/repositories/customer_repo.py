from __future__ import annotations

import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer import Customer
from app.schemas.customer import CustomerCreate


class CustomerRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, data: CustomerCreate) -> Customer:
        api_key = data.api_key or secrets.token_urlsafe(32)
        customer = Customer(
            vs_customer_id=data.vs_customer_id,
            api_key=api_key,
            twilio_account_sid=data.twilio_account_sid,
            twilio_auth_token=data.twilio_auth_token,
        )
        self.session.add(customer)
        await self.session.commit()
        await self.session.refresh(customer)
        return customer

    async def get_by_vs_id(self, vs_customer_id: int) -> Customer | None:
        result = await self.session.execute(
            select(Customer).where(
                Customer.vs_customer_id == vs_customer_id,
                Customer.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, customer_id: uuid.UUID) -> Customer | None:
        result = await self.session.execute(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_api_key(self, api_key: str) -> Customer | None:
        result = await self.session.execute(
            select(Customer).where(
                Customer.api_key == api_key,
                Customer.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[Customer]:
        result = await self.session.execute(
            select(Customer).where(Customer.active.is_(True))
        )
        return list(result.scalars().all())
