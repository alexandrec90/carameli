from __future__ import annotations

import uuid

import pytest

from tests.conftest import AUTH_HEADERS

_CUST_BASE = "/vsapi/1.0.0/VsCustomer"


async def _create_customer(client, vs_id: int) -> dict:
    payload = {
        "vs_customer_id": vs_id,
        "api_key": f"key-{vs_id}",
        "twilio_account_sid": f"ACtest{vs_id}",
        "twilio_auth_token": f"token{vs_id}",
    }
    resp = await client.post(f"{_CUST_BASE}/Create", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_voice_webhook_unknown_did_returns_fallback(client) -> None:
    """Call to a DID not in the DB should return a fallback TwiML response."""
    resp = await client.post(
        "/webhooks/twilio/voice",
        data={"To": "+19999999999", "From": "+14155550001", "CallSid": "CAtest001"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/xml")
    assert b"<Say>" in resp.content or b"<Hangup" in resp.content
    assert b"VoiceGateway. Please hold" not in resp.content  # old stub is gone


@pytest.mark.asyncio
async def test_voice_webhook_did_without_pointer_returns_fallback(
    client, db_session
) -> None:
    """A DID that exists but has no pointer should return a fallback."""
    customer_data = await _create_customer(client, 7001)

    from app.repositories.phone_line_repo import PhoneLineRepo

    line_repo = PhoneLineRepo(db_session)
    await line_repo.create(
        customer_id=uuid.UUID(customer_data["id"]),
        phone_number="+17001234567",
        twilio_sid="PNtest7001",
    )

    resp = await client.post(
        "/webhooks/twilio/voice",
        data={"To": "+17001234567", "From": "+14155550001", "CallSid": "CAtest002"},
    )
    assert resp.status_code == 200
    assert b"No agent" in resp.content


@pytest.mark.asyncio
async def test_voice_webhook_with_pointer_returns_sip_twiml(
    client, db_session
) -> None:
    """A fully configured DID → extension path should return a <Sip> dial TwiML."""
    customer_data = await _create_customer(client, 7002)
    cust_id = uuid.UUID(customer_data["id"])

    from app.repositories.phone_line_repo import PhoneLineRepo
    from app.repositories.extension_repo import ExtensionRepo
    from app.repositories.did_pointer_repo import DidPointerRepo

    line_repo = PhoneLineRepo(db_session)
    phone_line = await line_repo.create(
        customer_id=cust_id,
        phone_number="+17002234567",
        twilio_sid="PNtest7002",
    )

    ext_repo = ExtensionRepo(db_session)
    ext = await ext_repo.create(
        customer_id=cust_id,
        extension_number="201",
        sip_username="ext201_test7002",
        sip_credential_sid="CRtest7002",
        twilio_domain_sid="SDtest7002",
    )

    pointer_repo = DidPointerRepo(db_session)
    await pointer_repo.create(phone_line_id=phone_line.id, extension_id=ext.id)

    resp = await client.post(
        "/webhooks/twilio/voice",
        data={"To": "+17002234567", "From": "+14155550001", "CallSid": "CAtest003"},
    )
    assert resp.status_code == 200
    assert b"<Sip>" in resp.content
    assert b"ext201_test7002" in resp.content
    assert b"sip.twilio.com" in resp.content


@pytest.mark.asyncio
async def test_voice_webhook_sci_mismatch_returns_rejection(
    client, db_session
) -> None:
    """When SCI rules exist but the caller's NPA doesn't match, reject the call."""
    customer_data = await _create_customer(client, 7003)
    cust_id = uuid.UUID(customer_data["id"])

    from app.repositories.phone_line_repo import PhoneLineRepo
    from app.repositories.extension_repo import ExtensionRepo
    from app.repositories.did_pointer_repo import DidPointerRepo
    from app.repositories.sci_rule_repo import SciRuleRepo

    line_repo = PhoneLineRepo(db_session)
    phone_line = await line_repo.create(
        customer_id=cust_id, phone_number="+17003234567", twilio_sid="PNtest7003"
    )

    ext_repo = ExtensionRepo(db_session)
    ext = await ext_repo.create(
        customer_id=cust_id,
        extension_number="301",
        sip_username="ext301_test7003",
        sip_credential_sid="CRtest7003",
        twilio_domain_sid="SDtest7003",
    )

    pointer_repo = DidPointerRepo(db_session)
    await pointer_repo.create(phone_line_id=phone_line.id, extension_id=ext.id)

    # SCI rule: only allow callers whose NPA matches zip prefix "941xx"
    sci_repo = SciRuleRepo(db_session)
    await sci_repo.upsert(
        customer_id=cust_id,
        extension_id=ext.id,
        zip_code="94105",
        enabled=True,
    )

    # Caller from NPA 415 — zip prefix "415" ≠ "941" → rejected
    resp = await client.post(
        "/webhooks/twilio/voice",
        data={"To": "+17003234567", "From": "+14155550001", "CallSid": "CAtest004"},
    )
    assert resp.status_code == 200
    assert b"cannot be completed" in resp.content


@pytest.mark.asyncio
async def test_voice_webhook_sci_match_routes_to_sip(client, db_session) -> None:
    """When SCI rules match the caller's NPA, the call should route to SIP."""
    customer_data = await _create_customer(client, 7004)
    cust_id = uuid.UUID(customer_data["id"])

    from app.repositories.phone_line_repo import PhoneLineRepo
    from app.repositories.extension_repo import ExtensionRepo
    from app.repositories.did_pointer_repo import DidPointerRepo
    from app.repositories.sci_rule_repo import SciRuleRepo

    line_repo = PhoneLineRepo(db_session)
    phone_line = await line_repo.create(
        customer_id=cust_id, phone_number="+17004234567", twilio_sid="PNtest7004"
    )

    ext_repo = ExtensionRepo(db_session)
    ext = await ext_repo.create(
        customer_id=cust_id,
        extension_number="401",
        sip_username="ext401_test7004",
        sip_credential_sid="CRtest7004",
        twilio_domain_sid="SDtest7004",
    )

    pointer_repo = DidPointerRepo(db_session)
    await pointer_repo.create(phone_line_id=phone_line.id, extension_id=ext.id)

    # SCI rule matching zip prefix "415" — caller NPA 415 should match
    sci_repo = SciRuleRepo(db_session)
    await sci_repo.upsert(
        customer_id=cust_id,
        extension_id=ext.id,
        zip_code="41500",
        enabled=True,
    )

    resp = await client.post(
        "/webhooks/twilio/voice",
        data={"To": "+17004234567", "From": "+14155550001", "CallSid": "CAtest005"},
    )
    assert resp.status_code == 200
    assert b"<Sip>" in resp.content
    assert b"ext401_test7004" in resp.content
