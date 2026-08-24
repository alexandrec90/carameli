from __future__ import annotations

import hashlib
import hmac
import logging
from urllib.parse import quote

from app.core.config import settings
from app.services import s3_service

logger = logging.getLogger(__name__)

_S3_SCHEME = "s3://"


def recording_token(call_sid: str) -> str:
    """Long-lived HMAC token authorising a plain GET of one call's recording.

    CRM's recording service fetches the stored URL with a bare GET (no
    headers), so the token rides in the query string and does not expire.
    """
    return hmac.new(settings.api_key_secret.encode(), call_sid.encode(), hashlib.sha256).hexdigest()


def verify_recording_token(call_sid: str, token: str) -> bool:
    try:
        candidate = token.encode("ascii")
    except UnicodeEncodeError:
        return False
    return hmac.compare_digest(recording_token(call_sid).encode("ascii"), candidate)


def public_recording_url(call_sid: str) -> str:
    """Carameli-served recording URL handed to CRM and API consumers.

    jambonz_webhook_base_url is Carameli's public base URL (the ngrok domain in
    the prototype).
    """
    base = settings.jambonz_webhook_base_url.rstrip("/")
    return f"{base}/recordings/{quote(call_sid, safe='')}?token={recording_token(call_sid)}"


def resolve_recording_source(recording_url: str) -> str | None:
    """Resolve a stored recording_url to a directly fetchable URL.

    ``s3://bucket/key`` references are presigned via the configured S3 client;
    plain http(s) provider URLs pass through unchanged. Returns None when the
    reference cannot be resolved (e.g. S3 unconfigured).
    """
    if recording_url.startswith(_S3_SCHEME):
        remainder = recording_url[len(_S3_SCHEME) :]
        _, _, key = remainder.partition("/")
        if not key:
            logger.warning("Malformed s3 recording reference: %s", recording_url)
            return None
        return s3_service.get_presigned_download_url(key)
    return recording_url
