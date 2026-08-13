from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rest.deps import enforce_resource_scope, resolve_customer
from app.core.auth import AuthContext, get_auth_context
from app.core.database import get_session
from app.models.phone_line import PhoneLine
from app.schemas.phone_line import (
    CreatePhoneLineRequest,
    PhoneLineListResponse,
    PhoneLineResponse,
    UpdatePhoneLineRequest,
)
from app.services import customer_service, phone_line_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/phone-lines", tags=["phone-lines (rest)"])


@router.post(
    "",
    status_code=201,
    response_model=PhoneLineResponse,
    responses={
        400: {"description": "Invalid request"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Customer not found"},
        502: {"description": "Provider error"},
    },
)
async def create_phone_line(
    body: CreatePhoneLineRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Provision a DID at the active carrier and register it for the customer."""
    customer = await resolve_customer(session, auth, body.vs_customer_id)

    carrier = request.app.state.carrier
    try:
        result = await phone_line_service.acquire_did(
            carrier,
            phone_number=body.phone_number,
            area_code=body.area_code,
            country_code=body.country_code,
        )
    except ValueError as exc:
        logger.warning("Invalid DID request customer_id=%s: %s", customer.id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:
        logger.error("Provider error purchasing DID customer_id=%s: %s", customer.id, exc)
        raise HTTPException(status_code=502, detail="Provider error purchasing DID") from None

    line = await phone_line_service.create(
        session,
        customer_id=customer.id,
        phone_number=result["phone_number"],
        provider_sid=result["provider_sid"],
    )
    logger.info("Phone line created id=%s customer_id=%s", line.id, customer.id)
    return PhoneLineResponse.model_validate(line)


@router.get(
    "",
    response_model=PhoneLineListResponse,
    responses={
        400: {"description": "Invalid request"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Customer not found"},
    },
)
async def list_phone_lines(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    vs_customer_id: Annotated[int | None, Query(ge=1, le=2147483647)] = None,
) -> PhoneLineListResponse:
    """List the customer's active phone lines."""
    customer = await resolve_customer(session, auth, vs_customer_id)
    rows = await customer_service.get_phone_lines(session, customer.id)
    return PhoneLineListResponse(
        phone_lines=[PhoneLineResponse.model_validate(row) for row in rows]
    )


async def _load_line(session: AsyncSession, auth: AuthContext, line_id: uuid.UUID) -> PhoneLine:
    line = await session.get(PhoneLine, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")
    enforce_resource_scope(auth, line.customer_id)
    return line


@router.get(
    "/{line_id}",
    response_model=PhoneLineResponse,
    responses={
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Phone line not found"},
    },
)
async def get_phone_line(
    line_id: Annotated[uuid.UUID, Path()],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Get one phone line by its native id."""
    return PhoneLineResponse.model_validate(await _load_line(session, auth, line_id))


@router.patch(
    "/{line_id}",
    response_model=PhoneLineResponse,
    responses={
        400: {"description": "Invalid request"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "Phone line not found"},
        502: {"description": "Provider error"},
    },
)
async def update_phone_line(
    line_id: Annotated[uuid.UUID, Path()],
    body: UpdatePhoneLineRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> PhoneLineResponse:
    """Apply a partial update to a phone line.

    One verb replaces four legacy ones (`Deactivate`, `UpdateCallRecording`,
    `SetAutoAttendant`, `VsMessaging/Sms/Enable|Disable`). Only the fields present in
    the body are applied; carrier-side toggles run before the local write so a provider
    failure leaves the row untouched.
    """
    line = await _load_line(session, auth, line_id)
    sent = body.model_fields_set
    carrier = request.app.state.carrier

    if "sms_enabled" in sent and body.sms_enabled is not None:
        try:
            if body.sms_enabled:
                await carrier.enable_sms(line.provider_sid)
            else:
                await carrier.disable_sms(line.provider_sid)
        except Exception as exc:
            logger.error("Provider error toggling SMS line_id=%s: %s", line.id, exc)
            raise HTTPException(status_code=502, detail="Provider error toggling SMS") from None
        line = await phone_line_service.update_sms_enabled(session, line, body.sms_enabled)

    if "recording_enabled" in sent and body.recording_enabled is not None:
        line = await phone_line_service.update_recording_enabled(
            session, line, body.recording_enabled
        )

    if "auto_attendant_enabled" in sent and body.auto_attendant_enabled is not None:
        line = await phone_line_service.update_auto_attendant(
            session, line, body.auto_attendant_enabled, body.auto_attendant_max_digits
        )

    if "active" in sent and body.active is False:
        try:
            await carrier.release_number(line.provider_sid)
        except Exception as exc:
            logger.error("Provider error releasing DID line_id=%s: %s", line.id, exc)
            raise HTTPException(status_code=502, detail="Provider error releasing DID") from None
        line = await phone_line_service.deactivate(session, line)

    logger.info("Phone line updated id=%s fields=%s", line.id, sorted(sent))
    return PhoneLineResponse.model_validate(line)
