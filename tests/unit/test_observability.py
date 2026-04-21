from __future__ import annotations

import logging
from unittest.mock import AsyncMock

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_phone_line_add_logs_entry_and_success(client, caplog) -> None:
    """Successful DID provisioning should emit INFO logs with identifiers."""
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 6001, "api_key": "key-6001"},
        headers=AUTH_HEADERS,
    )

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+16001550001"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNobs001", "phone_number": "+16001550001"}
    )

    with caplog.at_level(logging.INFO, logger="app.api.vsapi.phone_lines"):
        resp = await client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 6001, "area_code": "600"},
            headers=AUTH_HEADERS,
        )

    assert resp.status_code == 201
    messages = [record.getMessage() for record in caplog.records]
    assert any("6001" in message for message in messages), "Expected vs_customer_id in logs"
    assert any("PNobs001" in message or "+16001550001" in message for message in messages), (
        "Expected phone number/SID in success logs"
    )


async def test_webhook_logs_call_sid(client, caplog, monkeypatch) -> None:
    """Jambonz webhook should log call_sid and status at INFO level."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "jambonz_webhook_secret", "")

    with caplog.at_level(logging.INFO, logger="app.api.webhooks.call_status"):
        resp = await client.post(
            "/webhooks/jambonz/call-status",
            json={
                "call_sid": "CAlogtest001",
                "call_status": "completed",
                "from": "+14155550000",
                "to": "+14155550001",
            },
        )

    assert resp.status_code == 200
    messages = " ".join(record.getMessage() for record in caplog.records)
    assert "CAlogtest001" in messages
    assert "completed" in messages


async def test_provider_error_logs_at_error_level(client, caplog) -> None:
    """Carrier provisioning failures should emit ERROR-level logs."""
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 6002, "api_key": "key-6002"},
        headers=AUTH_HEADERS,
    )

    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+16002550001"}])
    app.state.carrier.provision_number = AsyncMock(side_effect=Exception("Carrier error"))

    with caplog.at_level(logging.ERROR, logger="app.api.vsapi.phone_lines"):
        resp = await client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 6002, "area_code": "600"},
            headers=AUTH_HEADERS,
        )

    assert resp.status_code == 502
    error_records = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert error_records, "Expected at least one ERROR log on provider failure"
    assert any("6002" in record.getMessage() for record in error_records)


async def test_no_api_key_in_logs(client, caplog) -> None:
    """Ensure the API key secret never appears in logs."""
    from app.core.config import settings

    secret = settings.api_key_secret
    if not secret:
        pytest.skip("api_key_secret is not configured")

    with caplog.at_level(logging.DEBUG):
        await client.get("/vsapi/1.0.0/VsCustomer/Get/1", headers=AUTH_HEADERS)

    for record in caplog.records:
        assert secret not in record.getMessage(), f"API key leaked in log: {record.getMessage()}"


async def test_metrics_endpoint_tracks_request_count(client) -> None:
    """Prometheus metrics endpoint should expose request counters/histograms."""
    await client.get("/health")
    await client.get("/health")

    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "http_requests_total" in resp.text or "http_request_duration" in resp.text


async def test_frontend_logs_written_to_logger(client, caplog) -> None:
    """Frontend log ingestion endpoint should write entries to the `frontend` logger."""
    with caplog.at_level(logging.ERROR, logger="frontend"):
        resp = await client.post(
            "/vg/1.0.0/frontend-logs",
            json={
                "entries": [
                    {
                        "level": "error",
                        "message": "frontend-boom",
                        "context": {"status": 502},
                    }
                ]
            },
            headers=AUTH_HEADERS,
        )

    assert resp.status_code == 204
    frontend_records = [
        record for record in caplog.records if "frontend-boom" in record.getMessage()
    ]
    assert frontend_records, "Frontend error should appear in the 'frontend' logger"
    assert frontend_records[0].levelno == logging.ERROR
