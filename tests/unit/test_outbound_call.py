from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_LINE_BASE = "/vsapi/1.0.0/PhoneLine"
_EXT_BASE = "/vsapi/1.0.0/VsExtension"
_INITIATE_URL = "/vsapi/1.0.0/VsCall/Initiate"
_OUTBOUND_ANSWERED = "/webhooks/jambonz/outbound-answered"

_DID = "+14155550100"
_DESTINATION = "+12125550199"


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_phone_line(client, vs_id: int, number: str) -> None:
    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": f"PNline{vs_id}", "phone_number": number}
    )
    resp = await client.post(
        f"{_LINE_BASE}/Add",
        json={"vs_customer_id": vs_id, "phone_number": number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()


async def _add_extension(client, vs_id: int, ext_number: str) -> None:
    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": vs_id, "extension_number": ext_number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()


def _payload(vs_id: int, *, extension: str = "101", from_number: str = _DID) -> dict:
    return {
        "vs_customer_id": vs_id,
        "from_number": from_number,
        "destination_number": _DESTINATION,
        "extension": extension,
    }


# ---------------------------------------------------------------------------
# POST /VsCall/Initiate — happy path
# ---------------------------------------------------------------------------


async def test_initiate_outbound_call_success(client) -> None:
    """Valid request originates the call and returns call_sid + status."""
    from app.main import app

    await _create_customer(client, 9001)
    await _add_phone_line(client, 9001, _DID)
    await _add_extension(client, 9001, "101")

    app.state.engine.initiate_call = AsyncMock(
        return_value={"call_id": "CS-out-001", "status": "queued"}
    )

    resp = await client.post(_INITIATE_URL, json=_payload(9001), headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CS-out-001"
    assert body["status"] == "queued"

    app.state.engine.initiate_call.assert_awaited_once()
    kwargs = app.state.engine.initiate_call.call_args.kwargs
    assert kwargs["from_"] == _DID
    assert kwargs["to"] == _DESTINATION
    assert "outbound-answered" in kwargs["webhook_url"]
    # The agent SIP URI is carried in the Jambonz tag so the answer webhook is stateless.
    assert "agent_sip_uri" in kwargs["tag"]


# ---------------------------------------------------------------------------
# POST /VsCall/Initiate — error paths
# ---------------------------------------------------------------------------


async def test_initiate_unknown_customer_returns_404(client) -> None:
    resp = await client.post(_INITIATE_URL, json=_payload(99991), headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_initiate_unknown_phone_line_returns_404(client) -> None:
    await _create_customer(client, 9002)
    await _add_extension(client, 9002, "101")

    resp = await client.post(_INITIATE_URL, json=_payload(9002), headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Phone line not found"


async def test_initiate_unknown_extension_returns_404(client) -> None:
    await _create_customer(client, 9003)
    await _add_phone_line(client, 9003, _DID)

    resp = await client.post(
        _INITIATE_URL, json=_payload(9003, extension="999"), headers=AUTH_HEADERS
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Extension not found"


async def test_initiate_engine_error_returns_502(client) -> None:
    from app.main import app

    await _create_customer(client, 9004)
    await _add_phone_line(client, 9004, _DID)
    await _add_extension(client, 9004, "101")

    app.state.engine.initiate_call = AsyncMock(side_effect=RuntimeError("Jambonz unavailable"))

    resp = await client.post(_INITIATE_URL, json=_payload(9004), headers=AUTH_HEADERS)
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Call engine error"


async def test_initiate_no_auth_returns_401(client) -> None:
    resp = await client.post(_INITIATE_URL, json=_payload(9005))
    assert resp.status_code == 401


async def test_initiate_cross_customer_returns_403(client) -> None:
    """A customer-scoped token may not place calls for a different customer."""
    await _create_customer(client, 9006)
    await _create_customer(client, 9007)

    resp = await client.post(
        _INITIATE_URL,
        json=_payload(9007),
        headers={"Authorization": "Bearer key-9006"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /webhooks/jambonz/outbound-answered
# ---------------------------------------------------------------------------


async def test_outbound_answered_returns_dial_verb(client) -> None:
    """On answer, the webhook bridges to the agent SIP URI carried in the tag."""
    resp = await client.post(
        _OUTBOUND_ANSWERED,
        json={
            "call_sid": "CS-out-answered",
            "from": _DID,
            "tag": {"agent_sip_uri": "sip:ext101_abcd1234@domain"},
        },
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "dial"
    assert verbs[0]["callerId"] == _DID
    assert verbs[0]["target"][0]["sipUri"] == "sip:ext101_abcd1234@domain"


async def test_outbound_answered_missing_tag_returns_empty(client) -> None:
    """No agent SIP URI in the tag: return an empty verb array."""
    resp = await client.post(
        _OUTBOUND_ANSWERED,
        json={"call_sid": "CS-out-no-tag", "from": _DID},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_outbound_answered_invalid_json_returns_400(client) -> None:
    resp = await client.post(
        _OUTBOUND_ANSWERED,
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


async def test_outbound_answered_bad_signature_returns_403(client, monkeypatch) -> None:
    """A wrong X-Jambonz-Signature is rejected before the body is processed."""
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "webhook-key")
    resp = await client.post(
        _OUTBOUND_ANSWERED,
        content=b'{"call_sid":"CS-out-badsig","from":"%s"}' % _DID.encode(),
        headers={"Content-Type": "application/json", "X-Jambonz-Signature": "bad"},
    )
    assert resp.status_code == 403


async def test_outbound_answered_missing_signature_header_returns_403(client, monkeypatch) -> None:
    """A missing X-Jambonz-Signature when a secret is configured is rejected."""
    monkeypatch.setattr(settings, "jambonz_webhook_secret", "webhook-key")
    resp = await client.post(
        _OUTBOUND_ANSWERED,
        content=b'{"call_sid":"CS-out-nosig","from":"%s"}' % _DID.encode(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 403
