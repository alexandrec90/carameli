"""Live call transcription: verb emission, hook ingestion, and live fan-out.

Jambonz does the speech recognition, not Carameli. The `dial` verb accepts a nested
`transcribe` action, so attaching one to the dial we already emit forks the bridged
audio to the account's configured STT vendor and POSTs every interim and final result
back to `/webhooks/jambonz/transcription`. There is no audio path through this service
and no vendor credential in this repo -- that credential lives on the Jambonz account,
the same way `device_calling_application_sid` does.

Both parties come from one fork. A bridged call is two legs, so the fork is stereo and
`separateRecognitionPerChannel` runs a recogniser per channel; results then carry a
`channel`, which `TranscriptSession.local_channel` turns back into "our extension" or
"the far party".

Transcript text is call content: it is held in Redis for the length of the call plus a
short tail, published to subscribers, and **never logged**. Nothing here writes it to
Postgres -- durable transcripts are a separate feature with a retention policy of their
own, and would need one before this text outlives its TTL.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from redis.asyncio import Redis

from app.core.config import settings
from app.core.redis import get_redis_client
from app.schemas.transcript import Speaker, TranscriptSegment, TranscriptSession

logger = logging.getLogger(__name__)

_SESSION_PREFIX = "carameli:transcript:session:"
_BUFFER_PREFIX = "carameli:transcript:buffer:"
_SEQ_PREFIX = "carameli:transcript:seq:"
_STREAM_PREFIX = "carameli:transcript:stream:"

# A session outlives the buffer: a consumer joining a long call still has to be
# authorised against it after the earliest segments have aged out.
SESSION_TTL_SECONDS = 6 * 3600

# Sentinel published when a call reaches a terminal status, so a subscriber closes its
# stream instead of holding the connection open until its own timeout.
END_EVENT = "end"

# Jambonz forks the bridged call as stereo with the A leg -- the call that arrived at
# the feature server -- on channel 1 and the leg we dialled on channel 2. Which of
# those is *our* party therefore depends on who originated the call: a softphone
# dialling out is the A leg, a PSTN caller reaching an extension is not.
_LOCAL_CHANNEL_BY_DIRECTION = {"outbound": 1, "inbound": 2}


def transcription_enabled() -> bool:
    """Whether live transcription should be attached to newly built dial verbs."""
    return settings.transcription_enabled


def build_transcribe_action() -> dict[str, Any] | None:
    """Return the nested ``transcribe`` action for a ``dial`` verb, or None when off.

    Nested form: no ``"verb"`` key. Inside `dial`, jambonz reads the object as the
    transcribe verb's properties, and a stray ``verb`` member is not part of that
    contract.
    """
    if not transcription_enabled():
        return None
    return {
        "transcriptionHook": (
            f"{settings.jambonz_webhook_base_url}/webhooks/jambonz/transcription"
        ),
        "recognizer": {
            "vendor": settings.transcription_vendor,
            "language": settings.transcription_language,
            "interim": settings.transcription_interim,
            # One recogniser per forked channel is what makes the two parties
            # distinguishable at all; without it both sides arrive as one stream.
            "separateRecognitionPerChannel": True,
        },
    }


def local_channel_for(direction: str) -> int:
    """Return the forked channel carrying our own extension for a call direction."""
    return _LOCAL_CHANNEL_BY_DIRECTION.get(direction, 1)


def _session_key(call_sid: str) -> str:
    return _SESSION_PREFIX + call_sid


def _buffer_key(call_sid: str) -> str:
    return _BUFFER_PREFIX + call_sid


def _seq_key(call_sid: str) -> str:
    return _SEQ_PREFIX + call_sid


def stream_channel(call_sid: str) -> str:
    """Redis pub/sub channel carrying this call's live segments."""
    return _STREAM_PREFIX + call_sid


async def start_session(
    call_sid: str,
    *,
    customer_id: uuid.UUID,
    direction: str,
    extension_id: uuid.UUID | None = None,
) -> TranscriptSession | None:
    """Record who owns a transcribed call. Best-effort: never fails the caller.

    Called while building dial verbs, where a raised exception would cost the call
    itself -- a Redis outage must degrade transcription, not routing.
    """
    if not call_sid:
        return None
    session = TranscriptSession(
        call_sid=call_sid,
        customer_id=customer_id,
        extension_id=extension_id,
        direction="outbound" if direction == "outbound" else "inbound",
        local_channel=local_channel_for(direction),
    )
    client = get_redis_client()
    try:
        await client.set(
            _session_key(call_sid),
            session.model_dump_json(),
            ex=SESSION_TTL_SECONDS,
        )
    except Exception:
        logger.warning("Failed to record transcript session call_sid=%s", call_sid, exc_info=True)
        return None
    finally:
        await client.aclose()
    logger.info(
        "Transcript session started call_sid=%s direction=%s local_channel=%s",
        call_sid,
        session.direction,
        session.local_channel,
    )
    return session


async def get_session(call_sid: str, client: Redis | None = None) -> TranscriptSession | None:
    """Return the recorded session for a call, or None when it is unknown/expired."""
    own_client = client is None
    redis = client or get_redis_client()
    try:
        raw = await redis.get(_session_key(call_sid))
    except Exception:
        logger.warning("Failed to read transcript session call_sid=%s", call_sid, exc_info=True)
        return None
    finally:
        if own_client:
            await redis.aclose()
    if not raw:
        return None
    try:
        return TranscriptSession.model_validate_json(raw)
    except ValueError:
        logger.warning("Discarding malformed transcript session call_sid=%s", call_sid)
        return None


def speaker_for(session: TranscriptSession | None, channel: int | None) -> Speaker:
    """Label a forked channel as our party or the far one."""
    if session is None or channel is None:
        return "unknown"
    return "local" if channel == session.local_channel else "remote"


@dataclass(frozen=True)
class HookResult:
    """One recognition result lifted out of a transcription-hook body."""

    call_sid: str
    text: str
    is_final: bool
    channel: int | None
    confidence: float | None
    language: str | None


def parse_hook_payload(data: dict[str, Any]) -> HookResult | None:
    """Lift one recognition result out of a transcription-hook body.

    Returns None for a payload carrying no usable transcript -- an empty alternative,
    a result for a call we cannot identify, or a shape we do not recognise. Jambonz
    sends the recognised text under ``speech.alternatives[0].transcript``; the rest of
    the body is the standard call payload.
    """
    call_sid = str(data.get("call_sid") or "")
    if not call_sid:
        return None
    speech = data.get("speech")
    if not isinstance(speech, dict):
        return None
    alternatives = speech.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives:
        return None
    first = alternatives[0]
    if not isinstance(first, dict):
        return None
    text = str(first.get("transcript") or "").strip()
    if not text:
        return None

    confidence_raw = first.get("confidence")
    confidence = float(confidence_raw) if isinstance(confidence_raw, int | float) else None

    channel_raw = speech.get("channel")
    # bool is an int subclass, and a boolean channel is a malformed one.
    channel = (
        int(channel_raw)
        if isinstance(channel_raw, int | float) and not isinstance(channel_raw, bool)
        else None
    )

    language_raw = speech.get("language_code")
    language = str(language_raw) if language_raw else None

    return HookResult(
        call_sid=call_sid,
        text=text,
        is_final=bool(speech.get("is_final")),
        channel=channel,
        confidence=confidence,
        language=language,
    )


async def record_segment(
    call_sid: str,
    *,
    text: str,
    is_final: bool,
    channel: int | None,
    confidence: float | None,
    language: str | None,
) -> TranscriptSegment | None:
    """Publish one result to live subscribers, buffering it when it is final.

    Interim results are deliberately not buffered: each one supersedes the last, so a
    consumer joining mid-call wants the finalised transcript, not the half-formed
    guesses that produced it.
    """
    client = get_redis_client()
    try:
        session = await get_session(call_sid, client=client)
        seq = int(await client.incr(_seq_key(call_sid)))
        await client.expire(_seq_key(call_sid), SESSION_TTL_SECONDS)
        segment = TranscriptSegment(
            call_sid=call_sid,
            seq=seq,
            speaker=speaker_for(session, channel),
            channel=channel,
            text=text,
            is_final=is_final,
            confidence=confidence,
            language=language,
            at=datetime.now(UTC),
        )
        payload = segment.model_dump_json()
        if is_final:
            buffer_key = _buffer_key(call_sid)
            # redis-py's list commands are typed `Awaitable[T] | T` because the sync
            # and async clients share one signature; on this client they are always
            # awaitable.
            await cast(Awaitable[int], client.rpush(buffer_key, payload))
            await cast(
                Awaitable[bool],
                client.ltrim(buffer_key, -settings.transcription_buffer_max_segments, -1),
            )
            await client.expire(buffer_key, settings.transcription_buffer_ttl_seconds)
        await client.publish(stream_channel(call_sid), payload)
    except Exception:
        logger.warning("Failed to record transcript segment call_sid=%s", call_sid, exc_info=True)
        return None
    finally:
        await client.aclose()
    # Length, never content: the text is call content and does not belong in a log.
    logger.debug(
        "Transcript segment call_sid=%s seq=%s speaker=%s final=%s chars=%s",
        call_sid,
        segment.seq,
        segment.speaker,
        segment.is_final,
        len(text),
    )
    return segment


async def buffered_segments(call_sid: str) -> list[TranscriptSegment]:
    """Return the finalised segments buffered for a call, oldest first."""
    client = get_redis_client()
    try:
        raw_items = await cast(Awaitable[list[str]], client.lrange(_buffer_key(call_sid), 0, -1))
    except Exception:
        logger.warning("Failed to read transcript buffer call_sid=%s", call_sid, exc_info=True)
        return []
    finally:
        await client.aclose()
    segments: list[TranscriptSegment] = []
    for raw in raw_items:
        try:
            segments.append(TranscriptSegment.model_validate_json(raw))
        except ValueError:
            logger.warning("Discarding malformed buffered segment call_sid=%s", call_sid)
    return segments


async def close_session(call_sid: str) -> None:
    """Drop a finished call's state and tell subscribers the stream has ended.

    Best-effort, and called from the call-status webhook: a Redis failure here must
    not turn a successfully persisted call event into a provider retry.
    """
    if not call_sid:
        return
    client = get_redis_client()
    try:
        await client.publish(stream_channel(call_sid), json.dumps({"event": END_EVENT}))
        await client.delete(_session_key(call_sid), _seq_key(call_sid))
    except Exception:
        logger.warning("Failed to close transcript session call_sid=%s", call_sid, exc_info=True)
    finally:
        await client.aclose()


def is_end_message(raw: str) -> bool:
    """Whether a published message is the end-of-call sentinel."""
    try:
        parsed = json.loads(raw)
    except ValueError:
        return False
    return isinstance(parsed, dict) and parsed.get("event") == END_EVENT


async def subscribe(
    call_sid: str,
    *,
    idle_timeout: float = 15.0,
    max_seconds: float = SESSION_TTL_SECONDS,
) -> AsyncIterator[str | None]:
    """Yield raw JSON messages published for a call until its end sentinel arrives.

    Yields ``None`` every ``idle_timeout`` seconds of silence so the caller can emit a
    keep-alive; a quiet call is normal, and a connection that sends nothing for
    minutes is the one an intermediary drops. ``max_seconds`` bounds a stream whose
    end sentinel never arrives -- a call whose terminal status webhook was lost would
    otherwise hold the connection until the client gave up.

    The buffer is *not* replayed here; a consumer that wants the transcript so far
    fetches the snapshot first, then subscribes. Splitting them keeps this a pure
    tail, so a reconnecting client can pick up from a known ``seq`` without having to
    de-duplicate a replayed prefix.
    """
    deadline = time.monotonic() + max_seconds
    client = get_redis_client()
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(stream_channel(call_sid))
        while time.monotonic() < deadline:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=idle_timeout)
            if message is None:
                yield None
                continue
            data = message.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            if not isinstance(data, str):
                continue
            yield data
            if is_end_message(data):
                break
    finally:
        try:
            await pubsub.aclose()
        finally:
            await client.aclose()
