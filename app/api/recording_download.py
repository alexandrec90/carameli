from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services import call_event_service, recording_links

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"])


@router.get(
    "/{call_sid}",
    status_code=307,
    responses={
        307: {"description": "Redirect to the fetchable recording URL"},
        403: {"description": "Invalid token"},
        404: {"description": "Recording not found or unresolvable"},
    },
)
async def download_recording(
    call_sid: Annotated[str, Path(pattern=r"^[^\x00]+$")],
    token: Annotated[str, Query(min_length=1)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RedirectResponse:
    """Redirect a token-authenticated GET to the call's fetchable recording URL."""
    # public: no bearer auth — authenticated by a per-call HMAC query token so
    # VanillaSoft's recording service can fetch the MP3 with a plain GET.
    if not recording_links.verify_recording_token(call_sid, token):
        logger.warning("Recording download rejected: bad token call_sid=%s", call_sid)
        raise HTTPException(status_code=403, detail="Invalid token")

    event = await call_event_service.get_by_call_sid(session, call_sid)
    if not event or not event.recording_url:
        logger.warning("Recording download: no recording for call_sid=%s", call_sid)
        raise HTTPException(status_code=404, detail="Recording not found")

    target = recording_links.resolve_recording_source(event.recording_url)
    if not target:
        logger.warning("Recording download: unresolvable source call_sid=%s", call_sid)
        raise HTTPException(status_code=404, detail="Recording source unavailable")

    logger.info("Recording download redirect call_sid=%s", call_sid)
    return RedirectResponse(url=target, status_code=307)
