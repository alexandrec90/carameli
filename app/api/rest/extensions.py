from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rest.deps import enforce_resource_scope, resolve_customer
from app.core.auth import AuthContext, get_auth_context
from app.core.credential_vault import CredentialVaultError
from app.core.database import get_session
from app.schemas.extension import (
    CreateExtensionRangeRequest,
    CreateExtensionRequest,
    ExtensionListResponse,
    ExtensionResponse,
    UpdateExtensionRequest,
)
from app.services import extension_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/extensions", tags=["extensions (rest)"])


def _sip_username(customer_id: uuid.UUID, extension_number: str) -> str:
    return f"ext{extension_number}_{str(customer_id)[:8]}"


@router.post(
    "",
    status_code=201,
    response_model=ExtensionResponse,
    responses={
        400: {"description": "Invalid request"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Customer not found"},
        409: {"description": "Extension already exists"},
    },
)
async def create_extension(
    body: CreateExtensionRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExtensionResponse:
    """Create one SIP extension."""
    customer = await resolve_customer(session, auth, body.vs_customer_id)
    existing = await extension_service.get_by_number(session, customer.id, body.extension_number)
    if existing:
        logger.warning(
            "Extension already exists customer_id=%s ext=%s", customer.id, body.extension_number
        )
        raise HTTPException(status_code=409, detail="Extension already exists")

    try:
        ext = await extension_service.provision(
            session,
            request.app.state.engine,
            customer_id=customer.id,
            extension_number=body.extension_number,
            sip_username=_sip_username(customer.id, body.extension_number),
            password=body.password,
            first_name=body.first_name,
            last_name=body.last_name,
        )
    except CredentialVaultError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except Exception as exc:
        logger.error(
            "SIP client provisioning failed customer_id=%s ext=%s: %s",
            customer.id,
            body.extension_number,
            exc,
        )
        raise HTTPException(status_code=502, detail="Call engine provisioning failed") from None
    logger.info("Extension created id=%s customer_id=%s", ext.id, customer.id)
    return ExtensionResponse.model_validate(ext)


@router.post(
    "/bulk",
    status_code=201,
    response_model=ExtensionListResponse,
    responses={
        400: {"description": "Invalid range"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Customer not found"},
        409: {"description": "One or more extensions in the range already exist"},
    },
)
async def create_extension_range(
    body: CreateExtensionRangeRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExtensionListResponse:
    """Create every extension in an inclusive range, all-or-nothing.

    The legacy `VsExtension/Add` loop created 1..k and then reported total failure on
    the first conflict. Here the whole range is checked first and committed once, so a
    409 means nothing was created.
    """
    customer = await resolve_customer(session, auth, body.vs_customer_id)
    wanted = [str(n) for n in range(body.start_extension, body.end_extension + 1)]

    used = await extension_service.get_used_numbers(session, customer.id)
    clashes = sorted(set(wanted) & used)
    if clashes:
        logger.warning(
            "Extension range rejected customer_id=%s clashes=%s", customer.id, len(clashes)
        )
        raise HTTPException(
            status_code=409,
            detail=f"Extensions already exist: {', '.join(clashes)}",
        )

    try:
        rows = await extension_service.provision_many(
            session,
            request.app.state.engine,
            customer_id=customer.id,
            extensions=[(number, _sip_username(customer.id, number)) for number in wanted],
            first_name=body.first_name,
            last_name=body.last_name,
        )
    except CredentialVaultError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except Exception as exc:
        logger.error(
            "SIP client range provisioning failed customer_id=%s count=%s: %s",
            customer.id,
            len(wanted),
            exc,
        )
        raise HTTPException(status_code=502, detail="Call engine provisioning failed") from None
    logger.info("Extension range created customer_id=%s count=%s", customer.id, len(rows))
    return ExtensionListResponse(extensions=[ExtensionResponse.model_validate(row) for row in rows])


@router.get(
    "",
    response_model=ExtensionListResponse,
    responses={
        400: {"description": "Invalid request"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Customer not found"},
    },
)
async def list_extensions(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    vs_customer_id: Annotated[int | None, Query(ge=1, le=2147483647)] = None,
) -> ExtensionListResponse:
    """List the customer's active extensions."""
    customer = await resolve_customer(session, auth, vs_customer_id)
    rows = await extension_service.get_all_for_customer(session, customer.id)
    return ExtensionListResponse(extensions=[ExtensionResponse.model_validate(row) for row in rows])


@router.get(
    "/{extension_id}",
    response_model=ExtensionResponse,
    responses={
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Extension not found"},
    },
)
async def get_extension(
    extension_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExtensionResponse:
    """Get one extension by its native id."""
    ext = await extension_service.get_by_id(session, extension_id)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")
    enforce_resource_scope(auth, ext.customer_id)
    return ExtensionResponse.model_validate(ext)


@router.patch(
    "/{extension_id}",
    response_model=ExtensionResponse,
    responses={
        400: {"description": "Invalid request"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Extension not found"},
    },
)
async def update_extension(
    extension_id: Annotated[uuid.UUID, Path()],
    body: UpdateExtensionRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> ExtensionResponse:
    """Deactivate an extension.

    There is one removal operation, not two: extensions are never hard-deleted, so the
    legacy pair of `DeletePhoneOrExtension` overloads collapses to `active: false`.
    """
    ext = await extension_service.get_by_id(session, extension_id)
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")
    enforce_resource_scope(auth, ext.customer_id)

    if body.active:
        raise HTTPException(
            status_code=400,
            detail="active cannot be set back to true; create a new extension instead",
        )

    try:
        ext = await extension_service.deactivate_provisioned(session, request.app.state.engine, ext)
    except Exception as exc:
        logger.error("SIP client deprovisioning failed extension_id=%s: %s", ext.id, exc)
        raise HTTPException(status_code=502, detail="Call engine deprovisioning failed") from None
    logger.info("Extension deactivated id=%s", ext.id)
    return ExtensionResponse.model_validate(ext)
