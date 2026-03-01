from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    is_admin: bool
    customer_id: uuid.UUID | None
    vs_customer_id: int | None


def _raise_unauthorized() -> None:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing API key",
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_api_key(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Security(bearer_scheme)
    ],
) -> str:
    """Validate the Bearer API key against the configured secret."""
    if credentials is None or credentials.credentials != settings.api_key_secret:
        _raise_unauthorized()
    return credentials.credentials


async def get_auth_context(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Security(bearer_scheme)
    ],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthContext:
    """Authenticate using either the global service key or a customer API key."""
    if credentials is None:
        _raise_unauthorized()

    token = credentials.credentials
    if token == settings.api_key_secret:
        return AuthContext(is_admin=True, customer_id=None, vs_customer_id=None)

    customer = await CustomerRepo(session).get_by_api_key(token)
    if not customer:
        _raise_unauthorized()

    return AuthContext(
        is_admin=False,
        customer_id=customer.id,
        vs_customer_id=customer.vs_customer_id,
    )


def enforce_customer_scope(auth: AuthContext, vs_customer_id: int) -> None:
    """Ensure customer-scoped tokens only access their own VS customer id."""
    if auth.is_admin:
        return
    if auth.vs_customer_id != vs_customer_id:
        raise HTTPException(status_code=403, detail="Forbidden for this customer")
