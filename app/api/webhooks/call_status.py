from __future__ import annotations

import logging
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.request_validator import RequestValidator

from app.core.config import settings
from app.core.database import get_session
from app.repositories.call_event_repo import CallEventRepo
from app.repositories.customer_repo import CustomerRepo
from app.repositories.did_pointer_repo import DidPointerRepo
from app.repositories.extension_repo import ExtensionRepo
from app.repositories.phone_line_repo import PhoneLineRepo
from app.repositories.sci_rule_repo import SciRuleRepo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/twilio", tags=["webhooks"])
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}


def _validate_twilio_signature(request: Request, form_data: dict[str, Any]) -> None:
    """Reject requests that fail Twilio signature validation."""
    if not settings.twilio_auth_token:
        return  # Skip validation in dev if no token configured
    validator = RequestValidator(settings.twilio_auth_token)
    signature = request.headers.get("X-Twilio-Signature", "")
    url = str(request.url)
    if not validator.validate(url, form_data, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")


def _is_terminal_call_status(status: str | None) -> bool:
    return (status or "").lower() in _TERMINAL_CALL_STATUSES


def _vanillasoft_headers() -> dict[str, str]:
    if not settings.vanillasoft_webhook_secret:
        return {}
    return {"Authorization": f"Bearer {settings.vanillasoft_webhook_secret}"}


@router.post("/call-status")
async def call_status_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Receive Twilio call-status callbacks, persist to call_events, and notify VanillaSoft."""
    form = await request.form()
    payload: dict[str, Any] = dict(form)

    _validate_twilio_signature(request, payload)

    call_sid = payload.get("CallSid")
    if not call_sid:
        return Response(status_code=200)

    # Resolve customer_id from To/From numbers when available.
    customer_id = None
    line_repo = PhoneLineRepo(session)
    for phone_number in (payload.get("To", ""), payload.get("From", "")):
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
        logger.exception("Failed to persist call event for CallSid=%s", call_sid)
        return Response(status_code=200)

    # Write-back to VanillaSoft for terminal call states.
    if settings.vanillasoft_webhook_url and _is_terminal_call_status(call_event.status):
        customer_repo = CustomerRepo(session)
        customer = None
        if call_event.customer_id:
            customer = await customer_repo.get_by_id(call_event.customer_id)
        vs_payload = {
            "call_sid": call_event.twilio_call_sid,
            "vs_customer_id": customer.vs_customer_id if customer else None,
            "from": call_event.from_number,
            "to": call_event.to_number,
            "extension": call_event.extension,
            "duration_seconds": call_event.duration_seconds,
            "recording_url": call_event.recording_url,
            "status": call_event.status,
            "started_at": call_event.started_at.isoformat() if call_event.started_at else None,
            "ended_at": call_event.ended_at.isoformat() if call_event.ended_at else None,
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
                logger.info("Posted call event %s to VanillaSoft", call_sid)
            else:
                logger.warning(
                    "VanillaSoft webhook returned %s for call_sid=%s",
                    resp.status_code,
                    call_sid,
                )
        except Exception:
            logger.exception(
                "Failed to post call event %s to VanillaSoft; will retry", call_sid
            )

    return Response(status_code=200)


@router.post("/voice")
async def voice_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Handle inbound voice calls — routes to SIP extension via DID → pointer mapping.

    SCI zip-code matching uses Phase 1 simplification: the caller's NPA (area code,
    first 3 digits) is compared against the first 3 digits of each enabled zip_code rule.
    A full geo lookup can replace this in Phase 2.
    """
    form = await request.form()
    payload: dict[str, Any] = dict(form)

    _validate_twilio_signature(request, payload)

    to_number: str = payload.get("To", "")
    from_number: str = payload.get("From", "")

    logger.info("Inbound call from=%s to=%s", from_number, to_number)

    # 1. Look up the DID
    line_repo = PhoneLineRepo(session)
    phone_line = await line_repo.get_by_phone_number_global(to_number)
    if not phone_line:
        logger.warning("Inbound call to unrecognized DID: %s", to_number)
        twiml = (
            "<Response>"
            "<Say>This number is not configured. Goodbye.</Say>"
            "<Hangup/>"
            "</Response>"
        )
        return Response(content=twiml, media_type="application/xml")

    # 2. Look up the pointer (DID → extension mapping)
    pointer_repo = DidPointerRepo(session)
    pointer = await pointer_repo.get_for_phone_line(phone_line.id)
    if not pointer:
        logger.warning(
            "No extension pointer for DID %s (phone_line_id=%s)",
            to_number,
            phone_line.id,
        )
        twiml = (
            "<Response>"
            "<Say>No agent is configured for this number. Goodbye.</Say>"
            "<Hangup/>"
            "</Response>"
        )
        return Response(content=twiml, media_type="application/xml")

    # 3. Look up the extension
    ext_repo = ExtensionRepo(session)
    ext = await ext_repo.get_by_id(pointer.extension_id)
    if not ext:
        logger.warning("Extension %s not found or inactive", pointer.extension_id)
        twiml = (
            "<Response>"
            "<Say>Agent extension is unavailable. Goodbye.</Say>"
            "<Hangup/>"
            "</Response>"
        )
        return Response(content=twiml, media_type="application/xml")

    # 4. SCI check (Phase 1: NPA prefix match against zip_code first 3 digits)
    sci_repo = SciRuleRepo(session)
    sci_rules = await sci_repo.get_enabled_for_extension(ext.id)
    if sci_rules:
        # Strip leading + and country code 1 to get the NPA (area code)
        caller_npa = from_number.lstrip("+").lstrip("1")[:3] if from_number else ""
        matched = any(rule.zip_code[:3] == caller_npa for rule in sci_rules)
        if not matched:
            logger.info(
                "SCI mismatch: caller NPA=%s has no matching rule for extension %s",
                caller_npa,
                ext.extension_number,
            )
            twiml = (
                "<Response>"
                "<Say>Your call cannot be completed as dialed.</Say>"
                "<Hangup/>"
                "</Response>"
            )
            return Response(content=twiml, media_type="application/xml")

    if not ext.twilio_domain_sid:
        logger.warning("Extension %s has no Twilio domain SID", ext.id)
        twiml = (
            "<Response>"
            "<Say>Agent extension is unavailable. Goodbye.</Say>"
            "<Hangup/>"
            "</Response>"
        )
        return Response(content=twiml, media_type="application/xml")

    # Domain naming is deterministic from customer UUID (same rule as provisioning).
    sip_domain = f"vg-{str(ext.customer_id)[:8]}.sip.twilio.com"
    sip_uri = f"sip:{ext.sip_username}@{sip_domain}"

    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Dial>"
        f"<Sip>{sip_uri}</Sip>"
        "</Dial>"
        "</Response>"
    )
    logger.info(
        "Routing inbound call from=%s to DID=%s → %s", from_number, to_number, sip_uri
    )
    return Response(content=twiml, media_type="application/xml")


@router.post("/sms")
async def sms_webhook(request: Request) -> Response:
    """Handle inbound SMS messages — no-op acknowledgement."""
    form = await request.form()
    payload: dict[str, Any] = dict(form)
    _validate_twilio_signature(request, payload)
    return Response(status_code=204)
