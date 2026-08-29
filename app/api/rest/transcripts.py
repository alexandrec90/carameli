from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import StreamingResponse

from app.api.rest.deps import enforce_resource_scope
from app.core.auth import AuthContext, get_auth_context
from app.schemas.transcript import TranscriptSession, TranscriptSnapshot
from app.services import transcription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calls", tags=["transcripts (rest)"])

# A transcript is call content, so it must not sit in a proxy or in the browser's
# back/forward cache. X-Accel-Buffering is for the stream specifically: an nginx in
# front of the app buffers a response by default, which turns live subtitles into one
# batch delivered when the call ends.
_STREAM_HEADERS = {
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

_CallSid = Annotated[str, Path(min_length=1, max_length=128)]


async def _authorized_session(call_sid: str, auth: AuthContext) -> TranscriptSession:
    """Return the transcript session for a call the caller is allowed to read.

    404 when no session exists: either the call was never transcribed, or it ended
    long enough ago that its state has expired. Both are "nothing to show here", and
    neither reveals whether some other tenant is on a call right now.
    """
    session = await transcription.get_session(call_sid)
    if session is None:
        raise HTTPException(status_code=404, detail="No transcript for this call")
    enforce_resource_scope(auth, session.customer_id)
    return session


@router.get(
    "/{call_sid}/transcript",
    response_model=TranscriptSnapshot,
    responses={
        403: {"description": "Forbidden for this customer"},
        404: {"description": "No transcript for this call"},
    },
)
async def get_call_transcript(
    call_sid: _CallSid,
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> TranscriptSnapshot:
    """Return the finalised transcript so far for one call.

    The companion to the stream, not a substitute for it: a subtitle view fetches this
    once to render what has already been said, then subscribes for the rest.
    """
    await _authorized_session(call_sid, auth)
    segments = await transcription.buffered_segments(call_sid)
    return TranscriptSnapshot(call_sid=call_sid, segments=segments)


@router.get(
    "/{call_sid}/transcript/stream",
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "Live transcript events"},
        403: {"description": "Forbidden for this customer"},
        404: {"description": "No transcript for this call"},
    },
)
async def stream_call_transcript(
    call_sid: _CallSid,
    auth: Annotated[AuthContext, Depends(get_auth_context)],
) -> StreamingResponse:
    """Stream live transcript segments for one call as Server-Sent Events.

    Each `data:` frame is one `TranscriptSegment`, interim results included, so a
    consumer replaces the pending line for a speaker until `is_final` arrives. The
    stream ends with a `{"event": "end"}` frame when the call reaches a terminal
    status. Comment frames (`: keep-alive`) are emitted during silence and carry no
    data.

    Note for the UI wiring this up later: `EventSource` cannot send an Authorization
    header, so this needs either the session cookie (same-origin) or a fetch-based
    reader, not a bare `new EventSource(url)` with a bearer token.
    """
    await _authorized_session(call_sid, auth)

    async def events() -> AsyncIterator[str]:
        async for raw in transcription.subscribe(call_sid):
            if raw is None:
                yield ": keep-alive\n\n"
                continue
            yield f"data: {raw}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers=_STREAM_HEADERS)
