from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.base.exceptions import TwilioRestException

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.schemas.voicemail import VoicemailDropRequest, VoicemailDropResponse
from app.services.twilio_provider import TwilioProvider

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voicemail-drop"])


@router.post("/VsMessageDrop", response_model=VoicemailDropResponse)
async def voicemail_drop(
    body: VoicemailDropRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> VoicemailDropResponse:
    """Initiate an outbound call with AMD; play audio if answered by machine."""
    logger.info("Voicemail drop vs_customer_id=%s to=%s from=%s", body.vs_customer_id, body.msg_drop_number, body.extension)
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
        raise HTTPException(status_code=404, detail="Customer not found")

    provider: TwilioProvider = request.app.state.twilio
    try:
        result = await provider.initiate_voicemail_drop(
            to_number=body.msg_drop_number,
            from_number=body.extension,
            audio_url=body.audio_url,
        )
    except TwilioRestException as exc:
        logger.error("Twilio error initiating voicemail drop vs_customer_id=%s to=%s: %s", body.vs_customer_id, body.msg_drop_number, exc.msg)
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")

    logger.info("Voicemail drop initiated call_sid=%s status=%s", result["call_sid"], result["status"])
    return VoicemailDropResponse(call_sid=result["call_sid"], status=result["status"])
