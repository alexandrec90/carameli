from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.metrics import WEBHOOK_FAILURES_TOTAL
from app.core.sip import agent_sip_uri
from app.models.phone_line import PhoneLine
from app.schemas.call_event import WebhookAck
from app.services import (
    call_event_service,
    callback_state,
    customer_service,
    extension_service,
    phone_line_service,
    pointer_service,
    recording_links,
    vanillasoft_notify,
)

logger = logging.getLogger(__name__)
jambonz_router = APIRouter(prefix="/webhooks/jambonz", tags=["webhooks"])
_TERMINAL_CALL_STATUSES = {"completed", "no-answer", "busy", "failed", "canceled"}

# Jambonz config verb that starts native call recording (pushed to the
# account's configured S3/MinIO bucket).
_RECORD_START_VERB = {"verb": "config", "record": {"action": "startCallRecording"}}


def _is_terminal_call_status(status: str | None) -> bool:
    return (status or "").lower() in _TERMINAL_CALL_STATUSES


def _recording_enabled(phone_line: PhoneLine | None = None) -> bool:
    if settings.jambonz_record_all_calls:
        return True
    return bool(phone_line is not None and phone_line.recording_enabled)


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
        WEBHOOK_FAILURES_TOTAL.inc()
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


@jambonz_router.post(
    "/call-status",
    response_model=WebhookAck,
    responses={
        400: {"description": "Bad request (non-JSON body)"},
        403: {"description": "Forbidden (invalid signature)"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
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
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz call-status webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz call-status webhook received non-dict payload type: %s", type(data).__name__
        )
        return Response(status_code=400)

    call_sid = data.get("call_sid", "")
    if not call_sid:
        return JSONResponse({"status": "ok"})

    logger.info(
        "Jambonz call-status webhook: call_sid=%s status=%s duration=%s",
        call_sid,
        data.get("call_status"),
        data.get("duration"),
    )

    payload = _normalize_jambonz_payload(data)

    # Resolve customer_id from To/From numbers when available.
    customer_id = None
    try:
        for phone_number in (data.get("to", ""), data.get("from", "")):
            if not phone_number:
                continue
            phone_line = await phone_line_service.get_by_phone_number_global(session, phone_number)
            if phone_line:
                customer_id = phone_line.customer_id
                break
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Customer resolution failed for call_sid=%s", call_sid, exc_info=True)

    try:
        call_event = await call_event_service.create_from_webhook(
            session, customer_id=customer_id, payload=payload
        )
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.exception("Failed to persist Jambonz call event for call_sid=%s", call_sid)
        return JSONResponse({"status": "ok"})

    # Write-back to VanillaSoft for terminal call states (CloudliController contract).
    if settings.vanillasoft_webhook_url and _is_terminal_call_status(call_event.status):
        customer = None
        if call_event.customer_id:
            customer = await customer_service.get_by_id(session, call_event.customer_id)
        vs_customer_id = customer.vs_customer_id if customer else None
        try:
            posted = await vanillasoft_notify.post_notification(
                vanillasoft_notify.INCOMING_CALL_PATH,
                vanillasoft_notify.incoming_call_payload(call_event, vs_customer_id),
            )
            if posted:
                await call_event_service.mark_posted(session, call_event.id)
                logger.info("Posted Jambonz call event %s to VanillaSoft", call_sid)
        except Exception:
            WEBHOOK_FAILURES_TOTAL.inc()
            logger.exception(
                "Failed to post Jambonz call event %s to VanillaSoft; will retry",
                call_sid,
            )

        # Recording availability notification — fired once the recording URL lands.
        if call_event.recording_url:
            try:
                await vanillasoft_notify.post_notification(
                    vanillasoft_notify.CALL_RECORDING_PATH,
                    vanillasoft_notify.call_recording_payload(
                        call_event,
                        vs_customer_id,
                        recording_links.public_recording_url(call_event.call_sid),
                    ),
                )
            except Exception:
                WEBHOOK_FAILURES_TOTAL.inc()
                logger.exception(
                    "Failed to post CallRecording notification for call_sid=%s", call_sid
                )

    return JSONResponse({"status": "ok"})


@jambonz_router.post(
    "/incoming-call",
    responses={
        400: {"description": "Bad request (non-JSON body)"},
        403: {"description": "Forbidden (invalid signature)"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
async def jambonz_incoming_call_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Return a Jambonz verb array for inbound calls — gather DTMF if auto-attendant is on."""
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz incoming-call webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz incoming-call webhook received non-dict payload type: %s",
            type(data).__name__,
        )
        return Response(status_code=400)

    to_number: str = data.get("to", "") or ""
    call_sid: str = data.get("call_sid", "") or ""
    logger.info("Jambonz incoming-call webhook: call_sid=%s to=%s", call_sid, to_number)

    if not to_number:
        logger.warning("Jambonz incoming-call webhook: missing 'to' field call_sid=%s", call_sid)
        return JSONResponse([])

    try:
        phone_line = await phone_line_service.get_by_phone_number_global(session, to_number)
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Failed to look up phone line for incoming call to=%s call_sid=%s",
            to_number,
            call_sid,
            exc_info=True,
        )
        return JSONResponse([])

    if (
        phone_line is not None
        and phone_line.auto_attendant_enabled
        and phone_line.auto_attendant_max_digits
    ):
        action_hook = f"{settings.jambonz_webhook_base_url}/webhooks/jambonz/dtmf-result"
        logger.info(
            "Auto-attendant active for to=%s max_digits=%s call_sid=%s",
            to_number,
            phone_line.auto_attendant_max_digits,
            call_sid,
        )
        return JSONResponse(
            [
                {
                    "verb": "gather",
                    "input": ["digits"],
                    "numDigits": phone_line.auto_attendant_max_digits,
                    "actionHook": action_hook,
                }
            ]
        )

    # Direct DID → extension routing via did_pointers.
    if phone_line is not None:
        try:
            verbs = await _inbound_dial_verbs(
                session, phone_line, from_number=data.get("from", "") or ""
            )
        except Exception:
            WEBHOOK_FAILURES_TOTAL.inc()
            logger.warning(
                "Inbound routing failed for to=%s call_sid=%s", to_number, call_sid, exc_info=True
            )
            verbs = None
        if verbs is not None:
            logger.info("Routing inbound call_sid=%s to=%s to extension", call_sid, to_number)
            return JSONResponse(verbs)

    logger.warning(
        "No inbound route for to=%s call_sid=%s; answering with no verbs", to_number, call_sid
    )
    return JSONResponse([])


async def _inbound_dial_verbs(
    session: AsyncSession, phone_line: PhoneLine, from_number: str
) -> list[dict[str, Any]] | None:
    """Build the dial verb array for a DID mapped to an extension, or None."""
    pointer = await pointer_service.get_for_phone_line(session, phone_line.id)
    if pointer is None:
        return None
    ext = await extension_service.get_by_id(session, pointer.extension_id)
    if ext is None:
        return None
    verbs: list[dict[str, Any]] = []
    if _recording_enabled(phone_line):
        verbs.append(_RECORD_START_VERB)
    verbs.append(
        {
            "verb": "dial",
            "callerId": from_number,
            "target": [
                {"type": "sip", "sipUri": agent_sip_uri(ext.sip_username, ext.sip_domain_sid)}
            ],
        }
    )
    return verbs


@jambonz_router.post(
    "/dtmf-result",
    responses={
        400: {"description": "Bad request (non-JSON body)"},
        403: {"description": "Forbidden (invalid signature)"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
async def jambonz_dtmf_result_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Route gathered auto-attendant digits to the matching extension (or hang up)."""
    # auth: signature validation
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz dtmf-result webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz dtmf-result webhook received non-dict payload type: %s",
            type(data).__name__,
        )
        return Response(status_code=400)

    call_sid: str = data.get("call_sid", "") or ""
    to_number: str = data.get("to", "") or ""
    digits: str = data.get("digits", "") or ""
    logger.info(
        "Jambonz dtmf-result webhook: call_sid=%s to=%s digits=%s", call_sid, to_number, digits
    )

    _reject_verbs = [
        {"verb": "say", "text": "That extension was not found. Goodbye."},
        {"verb": "hangup"},
    ]

    if not digits or not to_number:
        return JSONResponse(_reject_verbs)

    try:
        phone_line = await phone_line_service.get_by_phone_number_global(session, to_number)
        if phone_line is None:
            return JSONResponse(_reject_verbs)
        ext = await extension_service.get_by_number(session, phone_line.customer_id, digits)
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "dtmf-result extension lookup failed to=%s digits=%s call_sid=%s",
            to_number,
            digits,
            call_sid,
            exc_info=True,
        )
        return JSONResponse(_reject_verbs)

    if ext is None:
        logger.warning(
            "dtmf-result: no extension %s for to=%s call_sid=%s", digits, to_number, call_sid
        )
        return JSONResponse(_reject_verbs)

    verbs: list[dict[str, Any]] = []
    if _recording_enabled(phone_line):
        verbs.append(_RECORD_START_VERB)
    verbs.append(
        {
            "verb": "dial",
            "callerId": data.get("from", "") or "",
            "target": [
                {"type": "sip", "sipUri": agent_sip_uri(ext.sip_username, ext.sip_domain_sid)}
            ],
        }
    )
    logger.info("dtmf-result: routing call_sid=%s to extension %s", call_sid, digits)
    return JSONResponse(verbs)


@jambonz_router.post(
    "/outbound-answered",
    responses={
        400: {"description": "Bad request (non-JSON body)"},
        403: {"description": "Forbidden (invalid signature)"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
async def jambonz_outbound_answered_webhook(
    request: Request,
) -> Response:
    """Bridge an answered outbound call to the agent SIP URI carried in the call tag."""
    # auth: signature validation
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz outbound-answered webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz outbound-answered webhook received non-dict payload type: %s",
            type(data).__name__,
        )
        return Response(status_code=400)

    call_sid: str = data.get("call_sid", "") or ""
    from_number: str = data.get("from", "") or ""
    tag = data.get("tag")
    sip_uri = tag.get("agent_sip_uri") if isinstance(tag, dict) else None
    logger.info("Jambonz outbound-answered webhook: call_sid=%s from=%s", call_sid, from_number)

    if not sip_uri:
        logger.warning("outbound-answered: missing agent_sip_uri call_sid=%s", call_sid)
        return JSONResponse([])

    logger.info("Bridging outbound call_sid=%s to agent=%s", call_sid, sip_uri)
    verbs: list[dict[str, Any]] = []
    if _recording_enabled():
        verbs.append(_RECORD_START_VERB)
    verbs.append(
        {
            "verb": "dial",
            "callerId": from_number,
            "target": [{"type": "sip", "sipUri": sip_uri}],
        }
    )
    return JSONResponse(verbs)


@jambonz_router.post(
    "/callback-answered",
    responses={
        400: {"description": "Bad request (non-JSON body)"},
        403: {"description": "Forbidden (invalid signature)"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
async def jambonz_callback_answered_webhook(
    request: Request,
) -> Response:
    """Return a Jambonz dial verb to bridge the answered agent leg to the contact number."""
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz callback-answered webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz callback-answered webhook received non-dict payload type: %s",
            type(data).__name__,
        )
        return Response(status_code=400)

    call_sid: str = data.get("call_sid", "") or ""
    from_number: str = data.get("from", "") or ""
    logger.info("Jambonz callback-answered webhook: call_sid=%s from=%s", call_sid, from_number)

    try:
        contact_number = await callback_state.pop_pending_callback(call_sid)
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.exception("callback-answered: Redis lookup failed for call_sid=%s", call_sid)
        contact_number = None

    if not contact_number:
        logger.warning("callback-answered: no pending callback for call_sid=%s", call_sid)
        return JSONResponse([])

    logger.info("Bridging agent call_sid=%s to contact=%s", call_sid, contact_number)
    verbs: list[dict[str, Any]] = []
    if _recording_enabled():
        verbs.append(_RECORD_START_VERB)
    verbs.append(
        {
            "verb": "dial",
            "callerId": from_number,
            "target": [{"type": "phone", "number": contact_number}],
        }
    )
    return JSONResponse(verbs)
