from __future__ import annotations

import base64
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.config import settings

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
async def telnyx_sms_inbound(request: Request) -> Response:
    """Receive inbound SMS messages from Telnyx, validate their signature, and log them.

    Telnyx payload shape::

        {
          "data": {
            "event_type": "message.received",
            "payload": {
              "from": { "phone_number": "+1..." },
              "to":   [{ "phone_number": "+1..." }],
              "text": "Hello"
            }
          }
        }

    A future PR can add DB persistence or forwarding logic after the
    ``logger.info`` call without touching the validation path.
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

    from_number = payload.get("from", {}).get("phone_number", "")
    to_numbers = [entry.get("phone_number", "") for entry in payload.get("to", [])]
    text = payload.get("text", "")

    logger.info(
        "Telnyx inbound SMS: event_type=%s from=%s to=%s text=%r",
        event_type,
        from_number,
        to_numbers,
        text,
    )

    return Response(status_code=204)
