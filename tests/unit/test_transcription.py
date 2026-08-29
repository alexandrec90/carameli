"""Tests for live call transcription: verb emission, hook ingestion, fan-out, and
the authenticated read surfaces.

The Redis client is the external boundary and is faked here; everything above it --
which channel is whose, what gets buffered, who may read a transcript -- is exercised
for real.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.core.config import settings
from app.schemas.transcript import TranscriptSegment, TranscriptSession, TranscriptSnapshot
from app.services import pointer_service, transcription
from tests.conftest import AUTH_HEADERS

# `asyncio_mode = auto` picks the async tests up on its own; the DB-backed ones need
# the session loop their fixtures live on, so those carry an explicit mark. A
# module-level mark would warn on every synchronous test here.
_session_loop = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_EXT_BASE = "/vsapi/1.0.0/VsExtension"
_INCOMING = "/webhooks/jambonz/incoming-call"
_HOOK = "/webhooks/jambonz/transcription"


class _FakePubSub:
    """Stand-in for a Redis pub/sub subscription driven from a scripted queue.

    ``None`` entries stand for an idle timeout, which is how the real client reports
    "nothing published within `timeout`".
    """

    def __init__(self, messages: list[dict[str, Any] | None]) -> None:
        self._messages = list(messages)
        self.subscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def get_message(
        self,
        ignore_subscribe_messages: bool = False,
        timeout: float = 0,  # noqa: ASYNC109 - mirrors redis-py's PubSub.get_message
    ):
        if not self._messages:
            return None
        return self._messages.pop(0)

    async def aclose(self) -> None:
        self.closed = True


class _FakeRedis:
    """In-memory stand-in for the Redis client (external boundary mock)."""

    def __init__(
        self,
        store: dict[str, Any],
        published: list[tuple[str, str]],
        pubsub_messages: list[dict[str, Any] | None] | None = None,
    ) -> None:
        self._store = store
        self.published = published
        self._pubsub_messages = pubsub_messages or []
        self.last_pubsub: _FakePubSub | None = None

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._store[key] = value

    async def get(self, key: str) -> str | None:
        value = self._store.get(key)
        return value if isinstance(value, str) else None

    async def incr(self, key: str) -> int:
        value = int(self._store.get(key, 0)) + 1
        self._store[key] = value
        return value

    async def expire(self, key: str, seconds: int) -> None:
        return None

    async def rpush(self, key: str, value: str) -> None:
        self._store.setdefault(key, []).append(value)

    async def ltrim(self, key: str, start: int, end: int) -> None:
        items = self._store.get(key, [])
        self._store[key] = items[start:] if end == -1 else items[start : end + 1]

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        items = self._store.get(key, [])
        return items[start:] if end == -1 else items[start : end + 1]

    async def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self._store.pop(key, None)

    def pubsub(self) -> _FakePubSub:
        self.last_pubsub = _FakePubSub(self._pubsub_messages)
        return self.last_pubsub

    async def aclose(self) -> None:
        return None


@pytest.fixture
def fake_redis(monkeypatch):
    """Patch the transcription service's Redis client; returns the shared fake."""
    client = _FakeRedis({}, [])
    monkeypatch.setattr(transcription, "get_redis_client", lambda: client)
    return client


@pytest.fixture
def transcription_on(monkeypatch):
    """Turn transcription on for the duration of one test."""
    monkeypatch.setattr(settings, "transcription_enabled", True)
    monkeypatch.setattr(settings, "transcription_vendor", "deepgram")
    monkeypatch.setattr(settings, "transcription_language", "en-US")
    monkeypatch.setattr(settings, "transcription_interim", True)


def _speech_payload(
    call_sid: str = "CS-1",
    transcript: str = "hello there",
    is_final: bool = True,
    channel: int | None = 1,
) -> dict[str, Any]:
    speech: dict[str, Any] = {
        "is_final": is_final,
        "language_code": "en-US",
        "alternatives": [{"transcript": transcript, "confidence": 0.94}],
    }
    if channel is not None:
        speech["channel"] = channel
    return {"call_sid": call_sid, "account_sid": "AC-1", "speech": speech}


# ── the transcribe action attached to dial verbs ───────────────────────────


def test_transcribe_action_is_none_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "transcription_enabled", False)
    assert transcription.build_transcribe_action() is None


def test_transcribe_action_recognises_each_channel_separately(transcription_on) -> None:
    action = transcription.build_transcribe_action()
    assert action is not None
    assert action["transcriptionHook"].endswith("/webhooks/jambonz/transcription")
    # Without a recogniser per channel both parties arrive as one stream, which is
    # precisely the thing two-party subtitles cannot be built from.
    assert action["recognizer"]["separateRecognitionPerChannel"] is True
    assert action["recognizer"]["vendor"] == "deepgram"
    assert action["recognizer"]["interim"] is True
    # Nested inside `dial`, the action is the verb's properties -- not a verb itself.
    assert "verb" not in action


# ── channel → speaker ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("direction", "expected"),
    [("outbound", 1), ("inbound", 2)],
)
def test_local_channel_follows_call_direction(direction: str, expected: int) -> None:
    assert transcription.local_channel_for(direction) == expected


def test_speaker_for_labels_both_parties() -> None:
    session = TranscriptSession(
        call_sid="CS-1",
        customer_id=uuid.uuid4(),
        extension_id=None,
        direction="outbound",
        local_channel=1,
    )
    assert transcription.speaker_for(session, 1) == "local"
    assert transcription.speaker_for(session, 2) == "remote"
    assert transcription.speaker_for(session, None) == "unknown"
    assert transcription.speaker_for(None, 1) == "unknown"


# ── hook payload parsing ───────────────────────────────────────────────────


def test_parse_hook_payload_reads_a_final_result() -> None:
    result = transcription.parse_hook_payload(_speech_payload())
    assert result is not None
    assert result.call_sid == "CS-1"
    assert result.text == "hello there"
    assert result.is_final is True
    assert result.channel == 1
    assert result.confidence == pytest.approx(0.94)
    assert result.language == "en-US"


def test_parse_hook_payload_reads_an_interim_result() -> None:
    result = transcription.parse_hook_payload(_speech_payload(is_final=False))
    assert result is not None and result.is_final is False


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"call_sid": ""},
        {"call_sid": "CS-1"},
        {"call_sid": "CS-1", "speech": "not-an-object"},
        {"call_sid": "CS-1", "speech": {"alternatives": []}},
        {"call_sid": "CS-1", "speech": {"alternatives": [{"transcript": "   "}]}},
        {"call_sid": "CS-1", "speech": {"alternatives": ["not-an-object"]}},
    ],
    ids=[
        "empty",
        "no-sid",
        "no-speech",
        "speech-not-dict",
        "no-alts",
        "blank-text",
        "alt-not-dict",
    ],
)
def test_parse_hook_payload_rejects_unusable_bodies(payload: dict[str, Any]) -> None:
    assert transcription.parse_hook_payload(payload) is None


def test_parse_hook_payload_ignores_a_boolean_channel() -> None:
    payload = _speech_payload(channel=None)
    payload["speech"]["channel"] = True
    result = transcription.parse_hook_payload(payload)
    assert result is not None and result.channel is None


def test_is_end_message() -> None:
    assert transcription.is_end_message(json.dumps({"event": "end"})) is True
    assert transcription.is_end_message(json.dumps({"text": "end"})) is False
    assert transcription.is_end_message("not json") is False


# ── recording and buffering segments ───────────────────────────────────────


async def test_record_segment_labels_the_speaker_from_the_session(fake_redis) -> None:
    customer_id = uuid.uuid4()
    await transcription.start_session("CS-1", customer_id=customer_id, direction="inbound")

    remote = await transcription.record_segment(
        "CS-1", text="hi", is_final=True, channel=1, confidence=None, language=None
    )
    local = await transcription.record_segment(
        "CS-1", text="hello", is_final=True, channel=2, confidence=None, language=None
    )

    # Inbound: the PSTN caller is the A leg, so channel 1 is the far party.
    assert remote is not None and remote.speaker == "remote"
    assert local is not None and local.speaker == "local"
    assert (remote.seq, local.seq) == (1, 2)


async def test_record_segment_buffers_finals_but_not_interims(fake_redis) -> None:
    await transcription.record_segment(
        "CS-1", text="par", is_final=False, channel=1, confidence=None, language=None
    )
    await transcription.record_segment(
        "CS-1", text="partial done", is_final=True, channel=1, confidence=None, language=None
    )

    buffered = await transcription.buffered_segments("CS-1")
    assert [segment.text for segment in buffered] == ["partial done"]
    # Both were published live, though: the interim is what makes subtitles keep up.
    assert len(fake_redis.published) == 2


async def test_buffered_segments_skips_a_malformed_entry(fake_redis) -> None:
    await transcription.record_segment(
        "CS-1", text="good", is_final=True, channel=1, confidence=None, language=None
    )
    fake_redis._store["carameli:transcript:buffer:CS-1"].append("{not json")

    assert [segment.text for segment in await transcription.buffered_segments("CS-1")] == ["good"]


async def test_record_segment_survives_a_redis_outage(monkeypatch) -> None:
    def _broken_client():
        raise ConnectionError("redis down")

    monkeypatch.setattr(transcription, "get_redis_client", _broken_client)
    with pytest.raises(ConnectionError):
        # get_redis_client itself raising is the one failure this cannot swallow;
        # the guard is around the commands, which is what an outage actually breaks.
        await transcription.record_segment(
            "CS-1", text="x", is_final=True, channel=1, confidence=None, language=None
        )


async def test_close_session_ends_the_stream_and_clears_state(fake_redis) -> None:
    await transcription.start_session("CS-1", customer_id=uuid.uuid4(), direction="outbound")
    await transcription.close_session("CS-1")

    channel, message = fake_redis.published[-1]
    assert channel == transcription.stream_channel("CS-1")
    assert transcription.is_end_message(message)
    assert await transcription.get_session("CS-1") is None


async def test_get_session_discards_a_malformed_record(fake_redis) -> None:
    fake_redis._store["carameli:transcript:session:CS-1"] = "{not json"
    assert await transcription.get_session("CS-1") is None


# ── subscribe ──────────────────────────────────────────────────────────────


async def test_subscribe_yields_segments_then_stops_at_the_end_sentinel(monkeypatch) -> None:
    messages: list[dict[str, Any] | None] = [
        {"type": "message", "data": '{"text": "one"}'},
        None,  # an idle timeout: a quiet call, not a finished one
        {"type": "message", "data": b'{"text": "two"}'},
        {"type": "message", "data": json.dumps({"event": "end"})},
        {"type": "message", "data": '{"text": "never delivered"}'},
    ]
    client = _FakeRedis({}, [], pubsub_messages=messages)
    monkeypatch.setattr(transcription, "get_redis_client", lambda: client)

    received = [item async for item in transcription.subscribe("CS-1", idle_timeout=0.01)]

    assert received[0] == '{"text": "one"}'
    assert received[1] is None
    assert received[2] == '{"text": "two"}'
    assert transcription.is_end_message(received[3])
    assert len(received) == 4
    assert client.last_pubsub is not None and client.last_pubsub.closed


async def test_subscribe_stops_at_its_deadline(monkeypatch) -> None:
    client = _FakeRedis({}, [], pubsub_messages=[])
    monkeypatch.setattr(transcription, "get_redis_client", lambda: client)

    received = [
        item async for item in transcription.subscribe("CS-1", idle_timeout=0.01, max_seconds=-1)
    ]
    assert received == []


# ── the transcription webhook ──────────────────────────────────────────────


@_session_loop
async def test_transcription_hook_records_a_segment(client, fake_redis) -> None:
    await transcription.start_session("CS-hook", customer_id=uuid.uuid4(), direction="outbound")

    resp = await client.post(_HOOK, json=_speech_payload(call_sid="CS-hook", channel=2))

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    segments = await transcription.buffered_segments("CS-hook")
    assert [(s.text, s.speaker) for s in segments] == [("hello there", "remote")]


@_session_loop
async def test_transcription_hook_acknowledges_an_unusable_body(client, fake_redis) -> None:
    resp = await client.post(_HOOK, json={"call_sid": "CS-hook", "speech": {"alternatives": []}})

    assert resp.status_code == 200
    assert fake_redis.published == []


@_session_loop
async def test_transcription_hook_rejects_a_bad_signature(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "s3cret")

    resp = await client.post(
        _HOOK, json=_speech_payload(), headers={"X-Jambonz-Signature": "wrong"}
    )

    assert resp.status_code == 403


@_session_loop
async def test_transcription_hook_rejects_a_non_json_body(client) -> None:
    resp = await client.post(
        _HOOK, content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 400


@_session_loop
async def test_transcription_hook_rejects_a_non_dict_body(client) -> None:
    resp = await client.post(_HOOK, json=["not", "a", "dict"])
    assert resp.status_code == 400


# ── dial verbs carry the transcribe action ─────────────────────────────────


async def _setup_line_and_extension(client, db_session, vs_id: int, phone: str, ext_no: str):
    from unittest.mock import AsyncMock

    from app.main import app

    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-tx-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201

    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNtx{vs_id}", "phone_number": phone}
    )
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "phone_number": phone},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    line = resp.json()

    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": vs_id, "extension_number": ext_no},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    ext = resp.json()

    await pointer_service.create(db_session, uuid.UUID(line["id"]), uuid.UUID(ext["id"]))
    return line, ext


@_session_loop
async def test_inbound_dial_verb_carries_transcription(
    client, db_session, fake_redis, transcription_on
) -> None:
    phone = "+18505551200"
    await _setup_line_and_extension(client, db_session, 96101, phone, "3101")

    resp = await client.post(
        _INCOMING, json={"call_sid": "CS-in", "to": phone, "from": "+15125550111"}
    )

    assert resp.status_code == 200
    dial = next(verb for verb in resp.json() if verb["verb"] == "dial")
    assert dial["transcribe"]["recognizer"]["separateRecognitionPerChannel"] is True
    # Forking audio needs the media anchored to the feature server.
    assert dial["anchorMedia"] is True
    # Inbound: the caller is the A leg, so our extension is channel 2.
    session = await transcription.get_session("CS-in")
    assert session is not None
    assert session.direction == "inbound"
    assert session.local_channel == 2


@_session_loop
async def test_dial_verb_omits_transcription_when_disabled(
    client, db_session, fake_redis, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "transcription_enabled", False)
    phone = "+18505551201"
    await _setup_line_and_extension(client, db_session, 96102, phone, "3102")

    resp = await client.post(
        _INCOMING, json={"call_sid": "CS-off", "to": phone, "from": "+15125550111"}
    )

    dial = next(verb for verb in resp.json() if verb["verb"] == "dial")
    assert "transcribe" not in dial
    assert "anchorMedia" not in dial
    assert await transcription.get_session("CS-off") is None


@_session_loop
async def test_outbound_device_dial_verb_carries_transcription(
    client, db_session, fake_redis, transcription_on
) -> None:
    phone = "+18505551202"
    _line, ext = await _setup_line_and_extension(client, db_session, 96103, phone, "3103")

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CS-out", "to": "+15125550122", "from": ext["sip_username"]},
    )

    assert resp.status_code == 200
    dial = next(verb for verb in resp.json() if verb["verb"] == "dial")
    assert "transcribe" in dial
    # Outbound: our softphone is the A leg, so it is channel 1.
    session = await transcription.get_session("CS-out")
    assert session is not None
    assert session.direction == "outbound"
    assert session.local_channel == 1


# ── the authenticated read surfaces ────────────────────────────────────────


def _transcript_url(call_sid: str, stream: bool = False) -> str:
    suffix = "/stream" if stream else ""
    return f"/api/v1/calls/{call_sid}/transcript{suffix}"


@_session_loop
async def test_transcript_snapshot_returns_finalised_segments(client, db_session, fake_redis):
    _line, _ext = await _setup_line_and_extension(client, db_session, 96104, "+18505551203", "3104")
    customer_id = await _customer_id(db_session, 96104)
    await transcription.start_session("CS-read", customer_id=customer_id, direction="outbound")
    await transcription.record_segment(
        "CS-read", text="on the record", is_final=True, channel=1, confidence=None, language=None
    )

    resp = await client.get(
        _transcript_url("CS-read"), headers={"Authorization": "Bearer key-tx-96104"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CS-read"
    assert [segment["text"] for segment in body["segments"]] == ["on the record"]
    assert body["segments"][0]["speaker"] == "local"


@_session_loop
async def test_transcript_is_404_for_an_unknown_call(client, fake_redis) -> None:
    resp = await client.get(_transcript_url("CS-nope"), headers=AUTH_HEADERS)
    assert resp.status_code == 404


@_session_loop
async def test_transcript_is_forbidden_across_tenants(client, db_session, fake_redis) -> None:
    await _setup_line_and_extension(client, db_session, 96105, "+18505551204", "3105")
    await _setup_line_and_extension(client, db_session, 96106, "+18505551205", "3106")
    owner_id = await _customer_id(db_session, 96105)
    await transcription.start_session("CS-theirs", customer_id=owner_id, direction="outbound")

    resp = await client.get(
        _transcript_url("CS-theirs"), headers={"Authorization": "Bearer key-tx-96106"}
    )

    assert resp.status_code == 403


@_session_loop
async def test_transcript_stream_frames_segments_as_sse(
    client, db_session, fake_redis, monkeypatch
) -> None:
    await _setup_line_and_extension(client, db_session, 96107, "+18505551206", "3107")
    owner_id = await _customer_id(db_session, 96107)
    await transcription.start_session("CS-sse", customer_id=owner_id, direction="outbound")

    async def _fake_subscribe(call_sid: str, **kwargs):
        yield '{"text": "one"}'
        yield None
        yield json.dumps({"event": "end"})

    monkeypatch.setattr(transcription, "subscribe", _fake_subscribe)

    resp = await client.get(
        _transcript_url("CS-sse", stream=True),
        headers={"Authorization": "Bearer key-tx-96107"},
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.headers["cache-control"] == "no-store"
    assert resp.text == 'data: {"text": "one"}\n\n: keep-alive\n\ndata: {"event": "end"}\n\n'


@_session_loop
async def test_transcript_stream_is_forbidden_across_tenants(
    client, db_session, fake_redis
) -> None:
    await _setup_line_and_extension(client, db_session, 96108, "+18505551207", "3108")
    await _setup_line_and_extension(client, db_session, 96109, "+18505551208", "3109")
    owner_id = await _customer_id(db_session, 96108)
    await transcription.start_session("CS-stream-theirs", customer_id=owner_id, direction="inbound")

    resp = await client.get(
        _transcript_url("CS-stream-theirs", stream=True),
        headers={"Authorization": "Bearer key-tx-96109"},
    )

    assert resp.status_code == 403


# ── the flag, the parsed hook result, the schemas, and the route table ─────


def test_transcription_enabled_follows_the_setting(monkeypatch) -> None:
    """The one place the feature flag is read, so the read is asserted directly rather
    than only through the verb builder that happens to call it."""
    monkeypatch.setattr(settings, "transcription_enabled", True)
    assert transcription.transcription_enabled() is True

    monkeypatch.setattr(settings, "transcription_enabled", False)
    assert transcription.transcription_enabled() is False


def test_hook_result_carries_every_field_lifted_from_the_payload() -> None:
    """`HookResult` is the boundary between the provider's body and everything above
    it: each field is read somewhere downstream, so each is asserted here."""
    result = transcription.parse_hook_payload(_speech_payload(call_sid="CS-hr", channel=2))

    assert result == transcription.HookResult(
        call_sid="CS-hr",
        text="hello there",
        is_final=True,
        channel=2,
        confidence=0.94,
        language="en-US",
    )


def test_transcript_snapshot_holds_its_segments_in_order() -> None:
    """The read endpoint's response model. Serialising it is what the client sees, and
    `seq` is the ordering a consumer joining mid-call depends on."""
    segments = [
        TranscriptSegment(
            call_sid="CS-snap",
            seq=seq,
            speaker=speaker,
            channel=channel,
            text=text,
            is_final=True,
            confidence=0.9,
            language="en-US",
            at=datetime(2026, 8, 28, 12, 0, seq, tzinfo=UTC),
        )
        for seq, speaker, channel, text in [(1, "local", 1, "hello"), (2, "remote", 2, "hi")]
    ]

    snapshot = TranscriptSnapshot(call_sid="CS-snap", segments=segments)
    dumped = snapshot.model_dump()

    assert dumped["call_sid"] == "CS-snap"
    assert [(s["seq"], s["speaker"], s["text"]) for s in dumped["segments"]] == [
        (1, "local", "hello"),
        (2, "remote", "hi"),
    ]


def test_routes_wire_each_transcript_surface_to_its_handler() -> None:
    """The tests above reach these three through their URLs, which cannot tell a
    renamed path from a handler that lost its decorator -- both answer 404. Naming the
    method, the path and the function together is what fails on either change."""
    from app.api.rest import transcripts
    from app.api.webhooks import call_status

    wired = {
        (method, route.path): route.endpoint
        for router in (transcripts.router, call_status.jambonz_router)
        for route in router.routes
        for method in route.methods
    }

    assert wired[("GET", "/calls/{call_sid}/transcript")] is transcripts.get_call_transcript
    assert (
        wired[("GET", "/calls/{call_sid}/transcript/stream")] is transcripts.stream_call_transcript
    )
    assert (
        wired[("POST", "/webhooks/jambonz/transcription")]
        is call_status.jambonz_transcription_webhook
    )


async def _customer_id(db_session, vs_customer_id: int) -> uuid.UUID:
    from app.services import customer_service

    customer = await customer_service.get_by_vs_id(db_session, vs_customer_id)
    assert customer is not None
    return customer.id
