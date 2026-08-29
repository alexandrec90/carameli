from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

logger = logging.getLogger(__name__)

Speaker = Literal["local", "remote", "unknown"]


class TranscriptSegment(BaseModel):
    """One recognition result for one party on one call.

    Jambonz emits several of these per utterance when interim results are on: a run
    of ``is_final=False`` guesses that each supersede the last, then one
    ``is_final=True`` result. Consumers rendering subtitles should replace the
    non-final line for a speaker rather than appending it.

    ``seq`` is a per-call counter assigned on receipt, so a consumer that joins mid
    call can order and de-duplicate without trusting wall-clock timestamps.
    """

    call_sid: str
    seq: int
    speaker: Speaker
    channel: int | None
    text: str
    is_final: bool
    confidence: float | None
    language: str | None
    at: datetime


class TranscriptSnapshot(BaseModel):
    """Finalised segments buffered so far for a call, oldest first."""

    call_sid: str
    segments: list[TranscriptSegment]


class TranscriptSession(BaseModel):
    """Who owns a transcribed call, and which forked channel is our own party.

    Written when the dial verbs carrying the nested ``transcribe`` action are built —
    that is the only point where the customer, the extension and the call direction
    are all in hand. The transcription hook and the streaming endpoints both read it:
    the hook to label a channel ``local`` or ``remote``, the endpoints to answer
    "may this tenant read this call".
    """

    call_sid: str
    customer_id: uuid.UUID
    extension_id: uuid.UUID | None
    direction: Literal["inbound", "outbound"]
    local_channel: int
