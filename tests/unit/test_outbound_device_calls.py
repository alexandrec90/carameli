"""Tests for device-originated call routing.

A softphone registered against the call engine sends its outbound calls to the
same ``incoming-call`` hook that carrier traffic arrives on; the only thing that
distinguishes them is a ``from`` matching one of our SIP usernames. Without the
branch these tests cover, the engine has no application to route a device call
to and rejects it with SIP 480.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from tests.conftest import AUTH_HEADERS
from tests.unit.test_inbound_routing import (
    _expected_sip_uri,
    _setup_customer_line_extension,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

_EXT_BASE = "/vsapi/1.0.0/VsExtension"
_INCOMING = "/webhooks/jambonz/incoming-call"


async def test_device_call_to_pstn_dials_out_with_the_did_as_caller_id(client, db_session) -> None:
    data = await _setup_customer_line_extension(client, db_session, 8801, "+18605550100", "401")

    resp = await client.post(
        _INCOMING,
        json={
            "call_sid": "CAdev001",
            "to": "+14388762750",
            "from": data["ext"]["sip_username"],
        },
    )

    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "dial"
    # Carriers reject a From that is not a number on the account, so the
    # extension's own DID — never its SIP username — is the caller ID.
    assert verbs[0]["callerId"] == "+18605550100"
    assert verbs[0]["answerOnBridge"] is True
    assert verbs[0]["target"] == [{"type": "phone", "number": "+14388762750"}]


async def test_device_call_normalizes_a_ten_digit_dial(client, db_session) -> None:
    data = await _setup_customer_line_extension(client, db_session, 8802, "+18615550100", "402")

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAdev002", "to": "4388762750", "from": data["ext"]["sip_username"]},
    )

    assert resp.status_code == 200
    verbs = resp.json()
    assert verbs[0]["target"] == [{"type": "phone", "number": "+14388762750"}]


async def test_device_call_without_a_did_is_not_placed(client, db_session) -> None:
    data = await _setup_customer_line_extension(
        client, db_session, 8803, "+18625550100", "403", with_pointer=False
    )

    resp = await client.post(
        _INCOMING,
        json={
            "call_sid": "CAdev003",
            "to": "+14388762750",
            "from": data["ext"]["sip_username"],
        },
    )

    assert resp.status_code == 200
    assert resp.json() == []


async def test_device_call_to_an_unroutable_destination_is_not_placed(client, db_session) -> None:
    data = await _setup_customer_line_extension(client, db_session, 8804, "+18635550100", "404")

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAdev004", "to": "*97", "from": data["ext"]["sip_username"]},
    )

    assert resp.status_code == 200
    assert resp.json() == []


async def test_device_call_to_a_sibling_extension_dials_sip_not_pstn(client, db_session) -> None:
    data = await _setup_customer_line_extension(client, db_session, 8805, "+18645550100", "405")
    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": 8805, "extension_number": "406"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    callee = resp.json()

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAdev005", "to": "406", "from": data["ext"]["sip_username"]},
    )

    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["callerId"] == "405"
    assert verbs[0]["target"] == [{"type": "sip", "sipUri": _expected_sip_uri(callee)}]


async def test_device_call_pins_the_trunk_when_one_is_configured(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "jambonz_outbound_trunk", "Telnyx")
    data = await _setup_customer_line_extension(client, db_session, 8806, "+18655550100", "407")

    resp = await client.post(
        _INCOMING,
        json={
            "call_sid": "CAdev006",
            "to": "+14388762750",
            "from": data["ext"]["sip_username"],
        },
    )

    assert resp.status_code == 200
    assert resp.json()[0]["target"] == [
        {"type": "phone", "number": "+14388762750", "trunk": "Telnyx"}
    ]


async def test_device_call_records_when_record_all_calls_is_on(
    client, db_session, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "jambonz_record_all_calls", True)
    data = await _setup_customer_line_extension(client, db_session, 8807, "+18665550100", "408")

    resp = await client.post(
        _INCOMING,
        json={
            "call_sid": "CAdev007",
            "to": "+14388762750",
            "from": data["ext"]["sip_username"],
        },
    )

    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 2
    assert verbs[0] == {"verb": "config", "record": {"action": "startCallRecording"}}
    assert verbs[1]["verb"] == "dial"


async def test_carrier_call_to_a_did_is_still_routed_inbound(client, db_session) -> None:
    """The device branch must not shadow ordinary inbound DID routing."""
    phone = "+18675550100"
    data = await _setup_customer_line_extension(client, db_session, 8808, phone, "409")

    resp = await client.post(
        _INCOMING,
        json={"call_sid": "CAdev008", "to": phone, "from": "+12125550001"},
    )

    assert resp.status_code == 200
    verbs = resp.json()
    assert verbs[0]["callerId"] == "+12125550001"
    assert verbs[0]["target"] == [{"type": "sip", "sipUri": _expected_sip_uri(data["ext"])}]
