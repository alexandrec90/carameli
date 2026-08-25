from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import settings
from app.models.call_event import CallEvent
from app.models.sms_message import SmsMessage

logger = logging.getLogger(__name__)

# Endpoint suffixes; the full path is
# {CRM_WEBHOOK_URL}/{CRM_NOTIFY_PREFIX}/{suffix}.
# The prefix selects the receiver: "notify" = the legacy notify controller,
# "carameli/notify" = honest CarameliNotifyController (post staging deploy).
INCOMING_CALL_PATH = "IncomingCall"
CALL_RECORDING_PATH = "CallRecording"
INCOMING_SMS_PATH = "IncomingSmsMessage"
SMS_DELIVERY_RECEIPT_PATH = "IncomingSmsMessageDeliveryReceipt"

SMS_PROVIDER_NAME = "Carameli"

# CRM's legacy notify controller drops recordings whose source is "asterisk";
# any other value is accepted.
RECORDING_SOURCE = "carameli"

# Maps Carameli call statuses to the eventName enum consumed by
# the legacy notify controller's incoming-call action (IncomingCall.cs).
_EVENT_NAME_BY_STATUS = {
    "completed": "callHungup",
    "no-answer": "callHungup",
    "busy": "callHungup",
    "failed": "callHungup",
    "canceled": "callHungup",
    "answered": "callAnswered",
    "ringing": "callReceived",
    "in-progress": "callInProgress",
}


def _epoch_seconds(value: datetime | None) -> int:
    if value is None:
        return int(datetime.now(UTC).timestamp())
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp())


def _isoformat(value: datetime | None) -> str:
    return (value or datetime.now(UTC).replace(tzinfo=None)).isoformat()


def incoming_call_payload(event: CallEvent, vs_customer_id: int | None) -> dict[str, Any]:
    """Build the IncomingCall.cs shape for POST notify/IncomingCall."""
    return {
        "callId": event.call_sid,
        "callIdUuid": event.call_sid,
        "timestamp": _epoch_seconds(event.ended_at or event.started_at),
        "from": event.from_number or "",
        "fromName": "",
        "fromNumber": event.from_number or "",
        "to": event.to_number or "",
        "toNumber": event.to_number or "",
        "accountId": str(vs_customer_id) if vs_customer_id is not None else "",
        "eventName": _EVENT_NAME_BY_STATUS.get((event.status or "").lower(), "callInProgress"),
        "isInbound": (event.direction or "").lower() == "inbound",
        "customerId": vs_customer_id or 0,
    }


def sms_message_payload(
    message: SmsMessage,
    vs_customer_id: int | None,
    media_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Build the SmsMessage.cs shape for POST notify/IncomingSmsMessage
    and notify/IncomingSmsMessageDeliveryReceipt (customerId is a string there)."""
    return {
        "referenceId": message.message_sid or "",
        "isOutbound": message.direction == "outbound",
        "smsProviderName": SMS_PROVIDER_NAME,
        "accountID": str(vs_customer_id) if vs_customer_id is not None else "",
        "from": message.from_number,
        "to": [message.to_number],
        "timestamp": _isoformat(message.created_at),
        "message": message.body,
        "mediaUrls": list(media_urls or []),
        "status": message.delivery_status or "",
        "customerId": str(vs_customer_id) if vs_customer_id is not None else "",
    }


def call_recording_payload(
    event: CallEvent, vs_customer_id: int | None, recording_file_url: str
) -> dict[str, Any]:
    """Build the CallRecording.cs shape for POST notify/CallRecording."""
    return {
        "accountId": str(vs_customer_id) if vs_customer_id is not None else "",
        "endpoint": event.extension or "",
        "recordDate": _isoformat(event.started_at),
        "endRecording": _isoformat(event.ended_at),
        "callerName": "",
        "callerNumber": event.from_number or "",
        "recordingFile": recording_file_url,
        "isInbound": (event.direction or "").lower() == "inbound",
        "length": event.duration_seconds or 0,
        "source": RECORDING_SOURCE,
        "callId": event.call_sid,
        "calleeNumber": event.to_number or "",
        "CustomerID": vs_customer_id or 0,
        "callIdParent": event.call_sid,
    }


def _truncate(text: str, limit: int = 2000) -> str:
    """Cap response-body text for logging; 2000 chars fits an ASP.NET error payload."""
    if len(text) <= limit:
        return text
    return text[:limit] + "...[truncated]"


SIGNATURE_HEADER = "X-Carameli-Signature"

# Replay window the receiver should enforce on the `t=` element, stated here because
# Carameli is the side that picks it. Mirrors the 300 s window Carameli already applies
# to Telnyx's signed callbacks.
SIGNATURE_TOLERANCE_SECONDS = 300


def sign_payload(body: bytes, timestamp: int, secret: str) -> str:
    """Build the `X-Carameli-Signature` value for an outbound notification.

    `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>." + body>`. The timestamp is inside
    the MAC, so a captured request cannot be replayed with a fresh one.
    """
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def _headers(body: bytes, timestamp: int | None = None) -> dict[str, str]:
    """Headers for a notify POST.

    Carameli signs with its **own** secret rather than reusing the legacy vendor's static
    `X-Log-Auth` value: one shared secret across two vendors means rotating either
    rotates both, and a leaked vendor secret authenticates as Carameli. The receiver
    now verifies this signature, so Carameli never sends the legacy vendor's credential.
    """
    headers = {"Content-Type": "application/json"}
    if settings.carameli_notify_secret:
        headers[SIGNATURE_HEADER] = sign_payload(
            body,
            int(time.time()) if timestamp is None else timestamp,
            settings.carameli_notify_secret,
        )
    return headers


def _notify_url(path: str) -> str:
    """Join base URL, the configured notify prefix and the endpoint suffix."""
    base = (settings.crm_webhook_url or "").rstrip("/")
    prefix = settings.crm_notify_prefix.strip("/")
    return f"{base}/{prefix}/{path.lstrip('/')}"


async def post_notification(path: str, payload: dict[str, Any]) -> bool:
    """POST a notify payload to CRM; returns True on 2xx, never raises."""
    if not settings.crm_webhook_url:
        return False
    url = _notify_url(path)
    # Serialize once and post the exact bytes that were signed. Handing httpx `json=`
    # would let it re-serialize, and a signature over a different encoding of the same
    # object is a signature the receiver cannot reproduce.
    body = json.dumps(payload, separators=(",", ":")).encode()
    try:
        async with httpx.AsyncClient() as client:
            # 30 s: the honest receiver (phase 02) processes synchronously and the
            # CRMWS SOAP hop can be slow; slower than that is a
            # CRM-side bug to fix there, not a reason to shorten this.
            resp = await client.post(url, content=body, headers=_headers(body), timeout=30.0)
    except Exception:
        logger.exception("CRM notify POST failed path=%s", path)
        return False
    if resp.is_success:
        logger.info("CRM notify POST ok path=%s", path)
        return True
    # After phase 02 (honest receiver) the response body carries CRM's
    # real failure detail — capture it. ref joins the failure to its
    # call_events / sms_messages row; never log the whole payload (PII rule).
    log = logger.error if resp.status_code >= 500 else logger.warning
    log(
        "CRM notify POST returned %s path=%s ref=%s body=%s",
        resp.status_code,
        path,
        payload.get("callId") or payload.get("referenceId"),
        _truncate(resp.text),
    )
    return False
