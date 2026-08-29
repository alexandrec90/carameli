from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.metrics import WEBHOOK_FAILURES_TOTAL
from app.core.phone import dialed_to_e164
from app.core.sip import agent_sip_uri
from app.models.extension import Extension
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
    transcription,
    crm_notify,
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


async def _with_transcription(
    dial_verb: dict[str, Any],
    *,
    call_sid: str,
    customer_id: uuid.UUID,
    direction: str,
    extension_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Attach live transcription to a dial verb, and record who owns the result.

    Returns ``dial_verb`` unchanged when transcription is off, so every call site can
    wrap unconditionally. The session record is what later lets the streaming
    endpoints answer "may this tenant read this call", and what turns a forked
    channel number back into "our extension" or "the far party" -- both facts are
    known here and nowhere downstream.
    """
    action = transcription.build_transcribe_action()
    if action is None:
        return dial_verb
    dial_verb["transcribe"] = action
    # Forking audio requires the media to stay on the feature server; releasing it
    # would leave nothing to transcribe once the legs are bridged.
    dial_verb["anchorMedia"] = True
    await transcription.start_session(
        call_sid,
        customer_id=customer_id,
        direction=direction,
        extension_id=extension_id,
    )
    return dial_verb


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
    """Receive Jambonz call-status callbacks, persist to call_events, and notify CRM."""
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

    # A finished call has no more subtitles coming; tell subscribers so they close
    # rather than waiting out their own timeout. Best-effort inside close_session, so
    # a Redis outage cannot turn a persisted call event into a provider retry.
    if _is_terminal_call_status(call_event.status):
        await transcription.close_session(call_sid)

    # Write-back to CRM for terminal call states (legacy notify controller contract).
    if settings.crm_webhook_url and _is_terminal_call_status(call_event.status):
        customer = None
        if call_event.customer_id:
            customer = await customer_service.get_by_id(session, call_event.customer_id)
        vs_customer_id = customer.vs_customer_id if customer else None
        try:
            posted = await crm_notify.post_notification(
                crm_notify.INCOMING_CALL_PATH,
                crm_notify.incoming_call_payload(call_event, vs_customer_id),
            )
            if posted:
                await call_event_service.mark_posted(session, call_event.id)
                logger.info("Posted Jambonz call event %s to CRM", call_sid)
        except Exception:
            WEBHOOK_FAILURES_TOTAL.inc()
            logger.exception(
                "Failed to post Jambonz call event %s to CRM; will retry",
                call_sid,
            )

        # Recording availability notification — fired once the recording URL lands.
        if call_event.recording_url:
            try:
                await crm_notify.post_notification(
                    crm_notify.CALL_RECORDING_PATH,
                    crm_notify.call_recording_payload(
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
    from_number: str = data.get("from", "") or ""
    logger.info("Jambonz incoming-call webhook: call_sid=%s to=%s", call_sid, to_number)

    if not to_number:
        logger.warning("Jambonz incoming-call webhook: missing 'to' field call_sid=%s", call_sid)
        return JSONResponse([])

    # A registered softphone dialling out arrives on this same hook, distinguished
    # only by its 'from' being one of our SIP usernames rather than a PSTN number.
    # Jambonz sends the bare user part, but tolerate a realm-qualified 'from' too —
    # a SIP username never contains '@', so this cannot widen the match.
    from_user = from_number.split("@", 1)[0]
    try:
        caller_ext = await extension_service.get_by_sip_username_global(session, from_user)
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Failed to look up calling extension for from=%s call_sid=%s",
            from_number,
            call_sid,
            exc_info=True,
        )
        caller_ext = None

    if caller_ext is not None:
        return JSONResponse(await _outbound_dial_verbs(session, caller_ext, to_number, call_sid))

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
                session,
                phone_line,
                from_number=data.get("from", "") or "",
                call_sid=call_sid,
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


async def _outbound_dial_verbs(
    session: AsyncSession, caller: Extension, to_number: str, call_sid: str
) -> list[dict[str, Any]]:
    """Build the dial verb array for a call placed by one of our registered devices."""
    internal = await extension_service.get_by_number(session, caller.customer_id, to_number)
    if internal is not None:
        logger.info(
            "Routing device call_sid=%s from ext=%s to ext=%s",
            call_sid,
            caller.extension_number,
            internal.extension_number,
        )
        return [
            await _with_transcription(
                {
                    "verb": "dial",
                    "callerId": caller.extension_number,
                    "answerOnBridge": True,
                    "target": [
                        {
                            "type": "sip",
                            "sipUri": agent_sip_uri(internal.sip_username, internal.sip_domain_sid),
                        }
                    ],
                },
                call_sid=call_sid,
                customer_id=caller.customer_id,
                direction="outbound",
                extension_id=caller.id,
            )
        ]

    destination = dialed_to_e164(to_number)
    if destination is None:
        logger.warning(
            "Device call_sid=%s from ext=%s dialled an unroutable destination",
            call_sid,
            caller.extension_number,
        )
        return []

    phone_line = await _outbound_caller_line(session, caller)
    if phone_line is None:
        # Carriers reject a From that is not a number on the account, so a device
        # with no DID assigned cannot place a PSTN call at all.
        logger.warning(
            "Device call_sid=%s from ext=%s has no DID for caller ID; dropping PSTN call",
            call_sid,
            caller.extension_number,
        )
        return []

    target: dict[str, Any] = {"type": "phone", "number": destination}
    if settings.jambonz_outbound_trunk:
        target["trunk"] = settings.jambonz_outbound_trunk

    verbs: list[dict[str, Any]] = []
    if _recording_enabled(phone_line):
        verbs.append(_RECORD_START_VERB)
    verbs.append(
        await _with_transcription(
            {
                "verb": "dial",
                "callerId": phone_line.phone_number,
                "answerOnBridge": True,
                "target": [target],
            },
            call_sid=call_sid,
            customer_id=caller.customer_id,
            direction="outbound",
            extension_id=caller.id,
        )
    )
    logger.info("Routing device call_sid=%s from ext=%s to PSTN", call_sid, caller.extension_number)
    return verbs


async def _outbound_caller_line(session: AsyncSession, caller: Extension) -> PhoneLine | None:
    """Return the phone line whose DID this extension presents as caller ID."""
    pointer = await pointer_service.get_for_extension(session, caller.id)
    if pointer is None:
        return None
    return await phone_line_service.get_by_id(session, pointer.phone_line_id)


async def _inbound_dial_verbs(
    session: AsyncSession, phone_line: PhoneLine, from_number: str, call_sid: str
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
        await _with_transcription(
            {
                "verb": "dial",
                "callerId": from_number,
                "target": [
                    {"type": "sip", "sipUri": agent_sip_uri(ext.sip_username, ext.sip_domain_sid)}
                ],
            },
            call_sid=call_sid,
            customer_id=phone_line.customer_id,
            direction="inbound",
            extension_id=ext.id,
        )
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
        await _with_transcription(
            {
                "verb": "dial",
                "callerId": data.get("from", "") or "",
                "target": [
                    {"type": "sip", "sipUri": agent_sip_uri(ext.sip_username, ext.sip_domain_sid)}
                ],
            },
            call_sid=call_sid,
            customer_id=phone_line.customer_id,
            direction="inbound",
            extension_id=ext.id,
        )
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
    session: Annotated[AsyncSession, Depends(get_session)],
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
    dial_verb: dict[str, Any] = {
        "verb": "dial",
        "callerId": from_number,
        "target": [{"type": "sip", "sipUri": sip_uri}],
    }
    # The contact is the A leg here — this call was placed *to* them and is now being
    # bridged to the agent — so our own party is the dialled leg, as on an inbound call.
    agent_ext = await _extension_for_sip_uri(session, sip_uri, call_sid)
    if agent_ext is not None:
        dial_verb = await _with_transcription(
            dial_verb,
            call_sid=call_sid,
            customer_id=agent_ext.customer_id,
            direction="inbound",
            extension_id=agent_ext.id,
        )
    verbs.append(dial_verb)
    return JSONResponse(verbs)


async def _extension_for_sip_uri(
    session: AsyncSession, sip_uri: str, call_sid: str
) -> Extension | None:
    """Resolve ``sip:user@realm`` back to the extension it belongs to, or None.

    Only transcription needs this — the bridge itself dials the URI as given — so a
    lookup failure is logged and swallowed rather than costing the call.
    """
    username = sip_uri.removeprefix("sip:").split("@", 1)[0].strip()
    if not username:
        return None
    try:
        return await extension_service.get_by_sip_username_global(session, username)
    except Exception:
        logger.warning(
            "Failed to resolve extension for agent SIP URI on call_sid=%s", call_sid, exc_info=True
        )
        return None


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
    session: Annotated[AsyncSession, Depends(get_session)],
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
    dial_verb: dict[str, Any] = {
        "verb": "dial",
        "callerId": from_number,
        "target": [{"type": "phone", "number": contact_number}],
    }
    # A callback rings the agent first, so our own party is the A leg here. The
    # agent's SIP URI is what this call was placed to; when it does not resolve to a
    # known extension there is no tenant to attribute the transcript to, so the call
    # is bridged untranscribed rather than producing segments nobody may read.
    agent_ext = await _extension_for_sip_uri(session, data.get("to", "") or "", call_sid)
    if agent_ext is not None:
        dial_verb = await _with_transcription(
            dial_verb,
            call_sid=call_sid,
            customer_id=agent_ext.customer_id,
            direction="outbound",
            extension_id=agent_ext.id,
        )
    verbs.append(dial_verb)
    return JSONResponse(verbs)


@jambonz_router.post(
    "/voicemail-hook",
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
async def jambonz_voicemail_hook_webhook(
    request: Request,
) -> Response:
    """Play the drop audio carried in the call tag, then hang up."""
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz voicemail-hook webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz voicemail-hook webhook received non-dict payload type: %s",
            type(data).__name__,
        )
        return Response(status_code=400)

    call_sid: str = data.get("call_sid", "") or ""
    tag = data.get("tag")
    audio_url = tag.get("audio_url") if isinstance(tag, dict) else None
    logger.info("Jambonz voicemail-hook webhook: call_sid=%s", call_sid)

    if not audio_url:
        logger.warning("voicemail-hook: missing audio_url call_sid=%s", call_sid)
        return JSONResponse([{"verb": "hangup"}])

    logger.info("Playing voicemail drop audio call_sid=%s", call_sid)
    return JSONResponse([{"verb": "play", "url": audio_url}, {"verb": "hangup"}])


@jambonz_router.post(
    "/transcription",
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
async def jambonz_transcription_webhook(request: Request) -> Response:
    """Receive one interim or final speech result and fan it out to live subscribers.

    Jambonz posts here several times a second per speaker while transcription is
    running, so this handler stays deliberately thin: no database, no CRM write-back,
    no verbs in the response. Nothing about the transcript text is logged — it is call
    content, and this endpoint is the one place all of it passes through.
    """
    # auth: signature validation
    raw_body = await request.body()
    signature = request.headers.get("X-Jambonz-Signature", "")
    _validate_jambonz_signature(raw_body, signature)

    try:
        data: dict[str, Any] = await request.json()
    except Exception:
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning("Jambonz transcription webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(data, dict):
        WEBHOOK_FAILURES_TOTAL.inc()
        logger.warning(
            "Jambonz transcription webhook received non-dict payload type: %s",
            type(data).__name__,
        )
        return Response(status_code=400)

    result = transcription.parse_hook_payload(data)
    if result is None:
        # A silent or unrecognisable result is ordinary, not an error: acknowledging
        # it keeps Jambonz from retrying a frame that will never parse.
        return JSONResponse({"status": "ok"})

    await transcription.record_segment(
        result.call_sid,
        text=result.text,
        is_final=result.is_final,
        channel=result.channel,
        confidence=result.confidence,
        language=result.language,
    )
    return JSONResponse({"status": "ok"})
