from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.base.exceptions import TwilioRestException

from app.core.auth import verify_api_key
from app.core.database import get_session
from app.repositories.customer_repo import CustomerRepo
from app.schemas.voicemail import VoicemailDropRequest, VoicemailDropResponse
from app.services.twilio_provider import TwilioProvider

router = APIRouter(tags=["voicemail-drop"])


@router.post("/VsMessageDrop", response_model=VoicemailDropResponse)
async def voicemail_drop(
    body: VoicemailDropRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[str, Depends(verify_api_key)],
) -> VoicemailDropResponse:
    """Initiate an outbound call with AMD; play audio if answered by machine."""
    customer_repo = CustomerRepo(session)
    customer = await customer_repo.get_by_vs_id(body.vs_customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    provider: TwilioProvider = request.app.state.twilio
    try:
        result = await provider.initiate_voicemail_drop(
            to_number=body.msg_drop_number,
            from_number=body.extension,
            audio_url=body.audio_url,
        )
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")

    return VoicemailDropResponse(call_sid=result["call_sid"], status=result["status"])
