from __future__ import annotations

import logging

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

logger = logging.getLogger(__name__)


def _key_by_api_key(request: Request) -> str:
    """Rate-limit per Bearer token; fall back to remote IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return get_remote_address(request)


limiter = Limiter(
    key_func=_key_by_api_key,
    storage_uri=settings.redis_url,
)
