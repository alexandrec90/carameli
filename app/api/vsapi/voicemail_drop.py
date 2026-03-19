from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, enforce_customer_scope, get_auth_context
from app.core.config import settings
from app.core.database import get_session
from app.core.limiter import limiter
from app.schemas.voicemail import VoicemailDropRequest, VoicemailDropResponse
from app.services import customer_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voicemail-drop"])


@router.post(
    "/VsMessageDrop",
    response_model=VoicemailDropResponse,
    responses={
        400: {"description": "Bad request"},
        404: {"description": "Customer not found"},
        502: {"description": "Provider error"},
    },
)
@limiter.limit(settings.rate_limit_calls)
async def voicemail_drop(
    body: VoicemailDropRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> VoicemailDropResponse:
    """Initiate an outbound call with AMD; play audio if answered by machine."""
    enforce_customer_scope(auth, body.vs_customer_id)
    logger.info(
        "Voicemail drop vs_customer_id=%s to=%s from=%s",
        body.vs_customer_id,
        body.msg_drop_number,
        body.extension,
    )
    customer = await customer_service.get_by_vs_id(session, body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    engine = request.app.state.engine
    try:
        result = await engine.initiate_voicemail_drop(
            to=body.msg_drop_number,
            from_=body.extension,
            audio_url=str(body.audio_url),
        )
    except Exception as exc:
        logger.error(
            "Provider error initiating voicemail drop vs_customer_id=%s to=%s: %s",
            body.vs_customer_id,
            body.msg_drop_number,
            exc,
        )
        raise HTTPException(
            status_code=502, detail="Provider error initiating voicemail drop"
        ) from None

    logger.info(
        "Voicemail drop initiated call_sid=%s status=%s",
        result["call_sid"],
        result["status"],
    )
    return VoicemailDropResponse(call_sid=result["call_sid"], status=result["status"])
