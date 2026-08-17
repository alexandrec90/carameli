from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.credential_vault import CredentialVaultError
from app.core.database import get_session
from app.schemas.account_data import AccountDataResponse, AccountExtensionCredential
from app.services import customer_service, extension_service

router = APIRouter(prefix="/AccessCheck", tags=["account-data"])


@router.post(
    "/AccountData",
    response_model=list[AccountDataResponse],
    response_model_by_alias=True,
    responses={404: {"description": "Customer not found"}, 503: {"description": "Vault error"}},
)
async def get_account_data(
    customer_ids: Annotated[list[int], Body(min_length=1, max_length=100)],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> list[AccountDataResponse]:
    """Deliver newly provisioned SIP passwords exactly once.

    Ordinary extension reads never expose passwords. After this response commits,
    the encrypted pending copies are erased and subsequent calls omit those rows.
    """
    customers = []
    for vs_customer_id in customer_ids:
        enforce_customer_scope(auth, vs_customer_id)
        customer = await customer_service.get_by_vs_id(session, vs_customer_id)
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        customers.append(customer)

    responses: list[AccountDataResponse] = []
    try:
        for vs_customer_id, customer in zip(customer_ids, customers, strict=True):
            credentials = await extension_service.consume_account_credentials(session, customer.id)
            responses.append(
                AccountDataResponse(
                    vs_customer_id=vs_customer_id,
                    extensions=[
                        AccountExtensionCredential(
                            full_name=" ".join(
                                part for part in (item.first_name, item.last_name) if part
                            ),
                            first_name=item.first_name,
                            last_name=item.last_name,
                            extension=item.extension,
                            sip_username=item.sip_username,
                            sip_password=item.sip_password,
                            sip_domain=item.sip_domain,
                        )
                        for item in credentials
                    ],
                )
            )
        await session.commit()
    except CredentialVaultError as exc:
        await session.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from None
    return responses
