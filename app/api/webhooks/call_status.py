from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.request_validator import RequestValidator

from app.core.config import settings
from app.core.database import get_session
from app.repositories.call_event_repo import CallEventRepo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/twilio", tags=["webhooks"])


def _validate_twilio_signature(request: Request, form_data: dict[str, Any]) -> None:
    """Reject requests that fail Twilio signature validation."""
    if not settings.twilio_auth_token:
        return  # Skip validation in dev if no token configured
    validator = RequestValidator(settings.twilio_auth_token)
    signature = request.headers.get("X-Twilio-Signature", "")
    url = str(request.url)
    if not validator.validate(url, form_data, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")


@router.post("/call-status")
async def call_status_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Receive Twilio call-status callbacks and persist to call_events."""
    form = await request.form()
    payload: dict[str, Any] = dict(form)

    _validate_twilio_signature(request, payload)

    call_sid = payload.get("CallSid")
    if not call_sid:
        return Response(status_code=200)

    repo = CallEventRepo(session)
    try:
        await repo.create_from_webhook(customer_id=None, payload=payload)
    except Exception:
        logger.exception("Failed to persist call event for CallSid=%s", call_sid)

    return Response(status_code=200)


@router.post("/voice")
async def voice_webhook(request: Request) -> Response:
    """Handle inbound voice calls — returns basic TwiML to acknowledge."""
    twiml = "<Response><Say>VoiceGateway. Please hold.</Say></Response>"
    return Response(content=twiml, media_type="text/xml")


@router.post("/sms")
async def sms_webhook(request: Request) -> Response:
    """Handle inbound SMS messages — no-op acknowledgement."""
    return Response(status_code=204)
