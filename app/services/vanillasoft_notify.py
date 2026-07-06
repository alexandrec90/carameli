from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import settings
from app.models.call_event import CallEvent
from app.models.sms_message import SmsMessage

logger = logging.getLogger(__name__)

# Path suffixes under VANILLASOFT_WEBHOOK_URL (the VanillaSoft.CloudliApi base).
INCOMING_CALL_PATH = "notify/IncomingCall"
CALL_RECORDING_PATH = "notify/CallRecording"
INCOMING_SMS_PATH = "notify/IncomingSmsMessage"
SMS_DELIVERY_RECEIPT_PATH = "notify/IncomingSmsMessageDeliveryReceipt"

SMS_PROVIDER_NAME = "Carameli"

# VanillaSoft's CloudliController drops recordings whose source is "asterisk";
# any other value is accepted.
RECORDING_SOURCE = "carameli"

# Maps Carameli call statuses to the eventName enum consumed by
# CloudliController.NotifyIncomingCall (IncomingCall.cs).
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


def _headers() -> dict[str, str]:
    if not settings.vanillasoft_webhook_secret:
        return {}
    return {"X-Cloudli-Auth": settings.vanillasoft_webhook_secret}


async def post_notification(path: str, payload: dict[str, Any]) -> bool:
    """POST a notify payload to VanillaSoft; returns True on 2xx, never raises."""
    if not settings.vanillasoft_webhook_url:
        return False
    url = settings.vanillasoft_webhook_url.rstrip("/") + "/" + path
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=_headers(), timeout=10.0)
    except Exception:
        logger.exception("VanillaSoft notify POST failed path=%s", path)
        return False
    if resp.is_success:
        logger.info("VanillaSoft notify POST ok path=%s", path)
        return True
    # After phase 02 (honest receiver) the response body carries VanillaSoft's
    # real failure detail — capture it. ref joins the failure to its
    # call_events / sms_messages row; never log the whole payload (PII rule).
    log = logger.error if resp.status_code >= 500 else logger.warning
    log(
        "VanillaSoft notify POST returned %s path=%s ref=%s body=%s",
        resp.status_code,
        path,
        payload.get("callId") or payload.get("referenceId"),
        _truncate(resp.text),
    )
    return False
