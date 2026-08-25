from __future__ import annotations

import hmac
import logging
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.vs_log import VsLogEntry
from app.services.crm_notify import _truncate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# NLog level string → Python logging level. NLog uploads uppercased (upperCase=true);
# we upper() defensively. Unknown levels fall back to WARNING so nothing is dropped.
_LEVEL_MAP = {
    "TRACE": logging.DEBUG,
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "FATAL": logging.CRITICAL,
    "CRITICAL": logging.CRITICAL,
}

# Exceptions get a longer cap than messages — a .NET stack trace is worth keeping.
_EXCEPTION_LIMIT = 4000


def _authorized(request: Request, entry_auth: str | None) -> bool:
    """Accept the shared secret from the configured auth header or the body's
    ``auth`` field (old NLog builds can't attach a header — see nlog-snippet.md).

    The header *name* is configuration (``LEGACY_LOG_AUTH_HEADER``) rather than a
    literal here: the legacy shipper sends a vendor-branded name, and that name is
    deployment detail, not something this repository needs to carry.

    Secret unconfigured → dev/CI mode, skip validation (established convention).
    """
    secret = settings.crm_webhook_secret
    if not secret:
        return True  # dev mode — skip
    provided = request.headers.get(settings.legacy_log_auth_header) or entry_auth or ""
    return hmac.compare_digest(provided, secret)


@router.post(
    "/vs-log",
    status_code=204,
    response_model=None,
    responses={
        400: {"description": "Bad request (non-JSON body or invalid schema)"},
        403: {"description": "Forbidden (invalid shared secret)"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
async def vs_log_ingest(request: Request) -> Response:
    """Ingest a CRM-side log record and re-emit it into ``carameli.log``.

    Covers CRM errors that never surface as an HTTP response Carameli
    sees (exceptions inside ``CarameliClient``/``CarameliService``). NLog's
    WebService target POSTs one JSON object per record; we authenticate via the
    shared secret, then log the record under a ``vs.``-prefixed logger so entries
    are grep-distinguishable (``| vs.`` in the diagnostics doc). Log-only — never
    persisted to the database.
    """
    # auth: shared-secret validation (LEGACY_LOG_AUTH_HEADER or body 'auth' field).
    # No customer scoping — server-to-server diagnostics channel, like other webhooks.
    try:
        body: Any = await request.json()
    except Exception:
        logger.warning("vs-log webhook received non-JSON body")
        return Response(status_code=400)

    if not isinstance(body, dict):
        logger.warning("vs-log webhook received non-object JSON body")
        return Response(status_code=400)

    if not _authorized(request, body.get("auth")):
        logger.warning("vs-log webhook rejected: invalid shared secret")
        return Response(status_code=403)

    try:
        entry = VsLogEntry.model_validate(body)
    except ValidationError:
        logger.warning("vs-log webhook received malformed payload")
        return Response(status_code=400)

    level = _LEVEL_MAP.get(entry.level.strip().upper(), logging.WARNING)
    message = _truncate(entry.message)
    exception_suffix = ""
    if entry.exception:
        exception_suffix = " | exception=" + _truncate(entry.exception, _EXCEPTION_LIMIT)

    logging.getLogger("vs." + entry.logger).log(
        level, "[staging %s] %s%s", entry.machine or "?", message, exception_suffix
    )
    return Response(status_code=204)
