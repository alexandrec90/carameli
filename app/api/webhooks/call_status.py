from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.customer_repo import CustomerRepo
from app.repositories.phone_line_repo import PhoneLineRepo

logger = logging.getLogger(__name__)
jambonz_router = APIRouter(prefix="/webhooks/jambonz", tags=["webhooks"])
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}


def _is_terminal_call_status(status: str | None) -> bool:
    return (status or "").lower() in _TERMINAL_CALL_STATUSES


def _vanillasoft_headers() -> dict[str, str]:
    if not settings.vanillasoft_webhook_secret:
        return {}
    return {"Authorization": f"Bearer {settings.vanillasoft_webhook_secret}"}


def _validate_jambonz_signature(raw_body: bytes, signature: str) -> None:
    """Reject requests that fail Jambonz HMAC-SHA256 signature validation."""
    if not settings.jambonz_webhook_secret:
        return  # Skip validation in dev if no secret configured
    expected = hmac.new(
        settings.jambonz_webhook_secret.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=403, detail="Invalid Jambonz signature")


def _normalize_jambonz_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Map Jambonz call-status fields to the shape create_from_webhook expects."""
    return {
        "CallSid": data.get("call_sid", ""),
        "CallStatus": data.get("call_status"),
        "CallDuration": data.get("duration"),
        "Direction": data.get("direction", "outbound"),
        "From": data.get("from"),
        "To": data.get("to"),
        "RecordingUrl": data.get("recording_url"),
    }


@jambonz_router.post("/call-status")
async def jambonz_call_status_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Receive Jambonz call-status callbacks, persist to call_events, and notify VanillaSoft."""
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        logger.warning("Jambonz call-status webhook received non-JSON body")
        return Response(status_code=400)

    call_sid = data.get("call_sid", "")
    if not call_sid:
        return Response(status_code=200)

    logger.info(
        "Jambonz call-status webhook: call_sid=%s status=%s duration=%s",
        call_sid,
        data.get("call_status"),
        data.get("duration"),
    )

    payload = _normalize_jambonz_payload(data)

    # Resolve customer_id from To/From numbers when available.
    customer_id = None
    line_repo = PhoneLineRepo(session)
    for phone_number in (data.get("to", ""), data.get("from", "")):
        if not phone_number:
            continue
        phone_line = await line_repo.get_by_phone_number_global(phone_number)
        if phone_line:
            customer_id = phone_line.customer_id
            break

    repo = CallEventRepo(session)
    try:
        call_event = await repo.create_from_webhook(
            customer_id=customer_id, payload=payload
        )
    except Exception:
        logger.exception(
            "Failed to persist Jambonz call event for call_sid=%s", call_sid
        )
        return Response(status_code=200)

    # Write-back to VanillaSoft for terminal call states.
    if settings.vanillasoft_webhook_url and _is_terminal_call_status(call_event.status):
        customer_repo = CustomerRepo(session)
        customer = None
        if call_event.customer_id:
            customer = await customer_repo.get_by_id(call_event.customer_id)
        vs_payload = {
            "call_sid": call_event.call_sid,
            "vs_customer_id": customer.vs_customer_id if customer else None,
            "from": call_event.from_number,
            "to": call_event.to_number,
            "extension": call_event.extension,
            "duration_seconds": call_event.duration_seconds,
            "recording_url": call_event.recording_url,
            "status": call_event.status,
            "started_at": call_event.started_at.isoformat()
            if call_event.started_at
            else None,
            "ended_at": call_event.ended_at.isoformat()
            if call_event.ended_at
            else None,
        }
        try:
            async with httpx.AsyncClient() as http_client:
                resp = await http_client.post(
                    settings.vanillasoft_webhook_url,
                    json=vs_payload,
                    headers=_vanillasoft_headers(),
                    timeout=10.0,
                )
            if resp.is_success:
                await repo.mark_posted(call_event.id)
                logger.info("Posted Jambonz call event %s to VanillaSoft", call_sid)
            else:
                logger.warning(
                    "VanillaSoft webhook returned %s for call_sid=%s",
                    resp.status_code,
                    call_sid,
                )
        except Exception:
            logger.exception(
                "Failed to post Jambonz call event %s to VanillaSoft; will retry",
                call_sid,
            )

    return Response(status_code=200)
