"""Session auth endpoints.

POST /auth/session      — auto-grant a session cookie (network-level trust)
DELETE /auth/session     — clear the session cookie
GET  /auth/me           — check whether the current session is valid

Security model: anyone who can reach the server is trusted (deploy behind
a VPN / firewall / reverse-proxy for access control).
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from app.core.auth import AuthContext, get_auth_context
from app.core.config import settings
from app.core.session import COOKIE_NAME, sign_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class SessionResponse(BaseModel):
    ok: bool


class MeResponse(BaseModel):
    authenticated: bool
    is_admin: bool
    vs_customer_id: int | None


@router.post("/session", response_model=SessionResponse)
async def create_session(response: Response) -> SessionResponse:
    """Grant a session cookie using the server's admin key.

    No credentials required — access control is handled at the network
    layer (VPN, firewall, reverse-proxy).
    """
    signed = sign_token(settings.api_key_secret)
    response.set_cookie(
        key=COOKIE_NAME,
        value=signed,
        httponly=True,
        secure=False,  # TODO: set True in production behind HTTPS
        samesite="lax",
        path="/",
        max_age=60 * 60 * 24 * 30,  # 30 days
    )
    logger.info("Auto-session granted via /auth/session")
    return SessionResponse(ok=True)


@router.delete("/session", response_model=SessionResponse)
async def destroy_session(response: Response) -> SessionResponse:
    """Clear the session cookie (logout)."""
    response.delete_cookie(key=COOKIE_NAME, path="/")
    logger.info("Session destroyed via /auth/session")
    return SessionResponse(ok=True)


@router.get("/me", response_model=MeResponse)
async def get_current_user(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> MeResponse:
    """Return identity of the currently authenticated session."""
    return MeResponse(
        authenticated=True,
        is_admin=auth.is_admin,
        vs_customer_id=auth.vs_customer_id,
    )
