from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 3.0


async def ping(slug: str = "") -> None:
    """Send a best-effort dead-man heartbeat without disrupting scheduled work."""
    base_url = settings.heartbeat_url.strip()
    if not base_url:
        return

    target_url = base_url.rstrip("/")
    if slug:
        target_url = f"{target_url}/{quote(slug, safe='')}"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(target_url)
            response.raise_for_status()
    except Exception:
        # The URL commonly contains a private monitor token, so never include it in logs.
        logger.warning("Heartbeat ping failed slug=%s", slug or "default", exc_info=True)
