"""Tests for inbound call routing: incoming-call DID→extension dial verbs and
the dtmf-result auto-attendant action hook."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.services import pointer_service
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_EXT_BASE = "/vsapi/1.0.0/VsExtension"
_INCOMING = "/webhooks/jambonz/incoming-call"
_DTMF = "/webhooks/jambonz/dtmf-result"


async def _setup_customer_line_extension(
    client, db_session, vs_id: int, phone: str, ext_number: str, with_pointer: bool = True
) -> dict:
    """Create customer + DID + extension (+ did_pointer) and return their fields."""
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-route-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201

    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNroute{vs_id}", "phone_number": phone}
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
        json={"vs_customer_id": vs_id, "extension_number": ext_number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    ext = resp.json()

    if with_pointer:
        await pointer_service.create(db_session, uuid.UUID(line["id"]), uuid.UUID(ext["id"]))
    return {"line": line, "ext": ext}


# ── incoming-call: DID → extension routing ─────────────────────────────────


async def test_incoming_call_with_pointer_returns_dial_verb(client, db_session) -> None:
    phone = "+18505550100"
    data = await _setup_customer_line_extension(client, db_session, 8701, phone, "301")

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAroute001", "to": phone, "from": "+12125550001"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "dial"
    assert verbs[0]["callerId"] == "+12125550001"
    assert verbs[0]["target"] == [{"type": "sip", "sipUri": data["ext"]["sip_username"]}]


async def test_incoming_call_without_pointer_returns_empty(client, db_session) -> None:
    phone = "+18515550100"
    await _setup_customer_line_extension(client, db_session, 8702, phone, "302", with_pointer=False)

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAroute002", "to": phone, "from": "+12125550001"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_incoming_call_unknown_did_returns_empty(client) -> None:
    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAroute003", "to": "+19998880000", "from": "+12125550001"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_incoming_call_record_all_calls_prepends_record_verb(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "jambonz_record_all_calls", True)
    phone = "+18525550100"
    await _setup_customer_line_extension(client, db_session, 8703, phone, "303")

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAroute004", "to": phone, "from": "+12125550001"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 2
    assert verbs[0] == {"verb": "config", "record": {"action": "startCallRecording"}}
    assert verbs[1]["verb"] == "dial"


async def test_incoming_call_line_recording_enabled_prepends_record_verb(
    client, db_session, monkeypatch
) -> None:
    """Per-line recording_enabled also triggers the record verb (global flag off)."""
    monkeypatch.setattr(settings, "jambonz_record_all_calls", False)
    phone = "+18535550100"
    await _setup_customer_line_extension(client, db_session, 8704, phone, "304")

    resp = await client.put(
        f"{_LINE_BASE}/UpdateCallRecording",
        json={"vs_customer_id": 8704, "phone_number": phone, "enabled": True},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAroute005", "to": phone, "from": "+12125550001"},
    )
    verbs = resp.json()
    assert verbs[0] == {"verb": "config", "record": {"action": "startCallRecording"}}
    assert verbs[1]["verb"] == "dial"


async def test_incoming_call_auto_attendant_takes_precedence_over_pointer(
    client, db_session
) -> None:
    phone = "+18545550100"
    await _setup_customer_line_extension(client, db_session, 8705, phone, "305")

    resp = await client.put(
        f"{_LINE_BASE}/SetAutoAttendant",
        json={"vs_customer_id": 8705, "phone_number": phone, "enabled": True, "max_digits": 3},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAroute006", "to": phone, "from": "+12125550001"},
    )
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "gather"


# ── dtmf-result ────────────────────────────────────────────────────────────


async def test_dtmf_result_routes_to_matching_extension(client, db_session) -> None:
    phone = "+18555550100"
    data = await _setup_customer_line_extension(
        client, db_session, 8706, phone, "306", with_pointer=False
    )

    resp = await client.post(
        _DTMF,
        json={"call_sid": "CAdtmf001", "to": phone, "from": "+12125550001", "digits": "306"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert verbs[-1]["verb"] == "dial"
    assert verbs[-1]["target"] == [{"type": "sip", "sipUri": data["ext"]["sip_username"]}]


async def test_dtmf_result_unknown_extension_says_goodbye(client, db_session) -> None:
    phone = "+18565550100"
    await _setup_customer_line_extension(client, db_session, 8707, phone, "307", with_pointer=False)

    resp = await client.post(
        _DTMF,
        json={"call_sid": "CAdtmf002", "to": phone, "from": "+12125550001", "digits": "999"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert [v["verb"] for v in verbs] == ["say", "hangup"]


async def test_dtmf_result_missing_digits_says_goodbye(client) -> None:
    resp = await client.post(
        _DTMF,
        json={"call_sid": "CAdtmf003", "to": "+18565550100", "from": "+12125550001"},
    )
    assert resp.status_code == 200
    assert [v["verb"] for v in resp.json()] == ["say", "hangup"]


async def test_dtmf_result_non_json_body_returns_400(client) -> None:
    resp = await client.post(
        _DTMF,
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


async def test_dtmf_result_missing_signature_returns_403(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "a-real-key")
    resp = await client.post(
        _DTMF,
        content=b'{"call_sid": "CAdtmf004", "digits": "306"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 403
