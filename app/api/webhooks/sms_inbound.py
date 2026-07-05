from __future__ import annotations

import base64
import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.services import (
    customer_service,
    phone_line_service,
    sms_message_service,
    vanillasoft_notify,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/telnyx", tags=["webhooks"])

_MAX_TIMESTAMP_AGE_SECONDS = 300

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PublicKey as _Ed25519PublicKey,
    )
except ImportError:
    logger.error("Missing cryptography dependency required for Telnyx signature validation")
    _Ed25519PublicKey = None  # type: ignore[assignment,misc]


def _validate_telnyx_signature(raw_body: bytes, signature: str, timestamp: str) -> None:
    """Verify the Ed25519 signature Telnyx attaches to every webhook.

    Signed payload format:  ``{timestamp}|{raw_request_body}``

    ``TELNYX_WEBHOOK_SECRET`` is the base64-encoded Ed25519 public key
    shown in the Telnyx portal under *Webhooks → Public Key*.

    Replay protection: requests whose timestamp is more than 300 s old are
    rejected.  Validation is skipped entirely when the secret is not set
    (dev / CI mode).
    """
    if not settings.telnyx_webhook_secret:
        return  # dev mode — skip

    if _Ed25519PublicKey is None:
        raise HTTPException(
            status_code=500,
            detail="Server misconfiguration: missing cryptography dependency",
        )

    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=403, detail="Missing or invalid telnyx-timestamp header"
        ) from None

    now = datetime.now(tz=UTC).timestamp()
    if abs(now - ts) > _MAX_TIMESTAMP_AGE_SECONDS:
        raise HTTPException(status_code=403, detail="Timestamp too old (replay protection)")

    signed_payload = f"{timestamp}|".encode() + raw_body

    try:
        pub_bytes = base64.b64decode(settings.telnyx_webhook_secret)
        public_key = _Ed25519PublicKey.from_public_bytes(pub_bytes)
        sig_bytes = base64.b64decode(signature)
        public_key.verify(sig_bytes, signed_payload)
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid Telnyx signature") from None


@router.post(
    "/sms-inbound",
    status_code=204,
    response_model=None,
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
async def telnyx_sms_inbound(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Receive inbound SMS and delivery-receipt events from Telnyx.

    Telnyx routes two event types to this endpoint:

    * ``message.received``  — inbound SMS (from a customer to our DID)
    * ``message.finalized`` — delivery receipt for an outbound SMS we sent

    Payload shape (both types)::

        {
          "data": {
            "event_type": "message.received" | "message.finalized",
            "payload": {
              "id": "<message_sid>",
              "from": { "phone_number": "+1...", "status": "..." },
              "to":   [{ "phone_number": "+1...", "status": "delivered" }],
              "errors": [{ "code": "..." }]
            }
          }
        }
    """
    raw_body = await request.body()
    signature = request.headers.get("telnyx-signature-ed25519", "")
    timestamp = request.headers.get("telnyx-timestamp", "")

    _validate_telnyx_signature(raw_body, signature, timestamp)

    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        logger.warning("Telnyx sms-inbound webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(body, dict):
        logger.warning("Telnyx sms-inbound webhook received non-object JSON body")
        return Response(status_code=400)

    event_type = body.get("data", {}).get("event_type", "")
    payload = body.get("data", {}).get("payload", {})

    if event_type == "message.finalized":
        await _handle_delivery_receipt(session, payload)
        return Response(status_code=204)

    if event_type == "message.received":
        await _handle_inbound_message(session, payload)

    return Response(status_code=204)


async def _handle_inbound_message(session: AsyncSession, payload: dict[str, Any]) -> None:
    """Persist an inbound SMS and forward it to VanillaSoft (notify/IncomingSmsMessage).

    Failed forwards are retried by the ``retry_unposted_sms_messages`` ARQ job,
    which picks up rows whose ``posted`` flag is still False.
    """
    message_sid: str = payload.get("id", "")
    from_number: str = payload.get("from", {}).get("phone_number", "")
    to_numbers = [entry.get("phone_number", "") for entry in payload.get("to", [])]
    to_number = to_numbers[0] if to_numbers else ""
    text: str = payload.get("text", "") or ""
    media_urls = [m.get("url", "") for m in (payload.get("media") or []) if m.get("url")]

    logger.info(
        "Telnyx inbound SMS: message_sid=%s from=%s to=%s",
        message_sid,
        from_number,
        to_numbers,
    )

    if not from_number or not to_number:
        logger.warning("Telnyx inbound SMS missing from/to; skipping message_sid=%s", message_sid)
        return

    # Telnyx retries webhooks — a message_sid we already stored is a duplicate.
    if message_sid:
        existing = await sms_message_service.get_by_message_sid(session, message_sid)
        if existing:
            logger.info("Telnyx inbound SMS duplicate message_sid=%s; skipping", message_sid)
            return

    phone_line = None
    customer = None
    try:
        phone_line = await phone_line_service.get_by_phone_number_global(session, to_number)
        if phone_line:
            customer = await customer_service.get_by_id(session, phone_line.customer_id)
    except Exception:
        logger.warning("Customer resolution failed for inbound SMS to=%s", to_number, exc_info=True)

    try:
        message = await sms_message_service.create_inbound(
            session,
            customer_id=phone_line.customer_id if phone_line else None,
            phone_line_id=phone_line.id if phone_line else None,
            message_sid=message_sid or None,
            from_number=from_number,
            to_number=to_number,
            body=text,
        )
    except Exception:
        logger.exception("Failed to persist inbound SMS message_sid=%s", message_sid)
        return

    if not settings.vanillasoft_webhook_url:
        return

    vs_customer_id = customer.vs_customer_id if customer else None
    posted = await vanillasoft_notify.post_notification(
        vanillasoft_notify.INCOMING_SMS_PATH,
        vanillasoft_notify.sms_message_payload(message, vs_customer_id, media_urls),
    )
    if posted:
        await sms_message_service.mark_posted(session, message.id)
        logger.info("Forwarded inbound SMS %s to VanillaSoft", message_sid)
    else:
        logger.warning(
            "Inbound SMS forward failed message_sid=%s; retry job will pick it up", message_sid
        )


async def _handle_delivery_receipt(session: AsyncSession, payload: dict[str, Any]) -> None:
    """Update SmsMessage.delivery_status from a Telnyx message.finalized event.

    The delivery status is reported per-recipient in ``payload.to[].status``.
    We use the first recipient's status (Carameli sends point-to-point SMS).
    Error codes come from ``payload.errors[].code`` if present.
    """
    message_sid: str = payload.get("id", "")
    if not message_sid:
        logger.warning("Telnyx delivery receipt missing message id; skipping")
        return

    to_entries: list[dict[str, Any]] = payload.get("to", [])
    delivery_status: str = (to_entries[0].get("status", "") if to_entries else "") or ""

    errors: list[dict[str, Any]] = payload.get("errors", [])
    error_code: str | None = str(errors[0].get("code", "")) if errors else None

    logger.info(
        "Telnyx delivery receipt: message_sid=%s status=%s error_code=%s",
        message_sid,
        delivery_status,
        error_code,
    )

    found = await sms_message_service.update_delivery_status(
        session, message_sid, delivery_status, error_code
    )
    if not found:
        logger.warning(
            "Telnyx delivery receipt: no SmsMessage row found for message_sid=%s", message_sid
        )
        return

    # Forward the receipt to VanillaSoft so it can update the SMS delivery status.
    if not settings.vanillasoft_webhook_url:
        return
    try:
        message = await sms_message_service.get_by_message_sid(session, message_sid)
        if message is None:
            return
        vs_customer_id = None
        if message.customer_id:
            customer = await customer_service.get_by_id(session, message.customer_id)
            vs_customer_id = customer.vs_customer_id if customer else None
        await vanillasoft_notify.post_notification(
            vanillasoft_notify.SMS_DELIVERY_RECEIPT_PATH,
            vanillasoft_notify.sms_message_payload(message, vs_customer_id),
        )
    except Exception:
        logger.exception(
            "Failed to forward delivery receipt to VanillaSoft message_sid=%s", message_sid
        )
