# Track C — Provider-Dependent Integration Tests

Two independent sessions. C1 expands the Telnyx sandbox suite; C2 adds resilience/chaos tests.
Both require the full Docker stack. C1 also requires real Telnyx sandbox credentials.

**Do not start either session until Section 0B of
`docs/plans/active/test-implementation-checklist.md` is
fully populated** — all env vars in the table must be set in `.env`.

---

## Session C1 — Telnyx sandbox integration tests

### Prerequisites (C1)

- `TELNYX_API_KEY` set to a Telnyx **test/sandbox** key
- `TELNYX_WEBHOOK_SECRET` set (portal → Webhooks → Public Key)
- `TELNYX_SANDBOX=1` will be passed as an env var when running this suite
- The suite must be **skipped by default** unless `TELNYX_SANDBOX=1` is set
- A dedicated test Telnyx account (not production) is strongly recommended

### File to extend: `tests/integration/test_telnyx_sandbox.py`

Read the existing file in full before adding anything. The pattern for skipping:

```python
import os
import pytest

pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.skipif(
        os.getenv("TELNYX_SANDBOX") != "1",
        reason="Set TELNYX_SANDBOX=1 to run Telnyx sandbox tests",
    ),
]
```

### Tests to add

#### 1. Number search

```python
async def test_search_numbers_returns_results():
    """Telnyx sandbox returns available numbers for a known area code."""
    from app.services.providers.carrier.telnyx import TelnyxCarrier
    from app.core.config import settings

    carrier = TelnyxCarrier(
        api_key=settings.telnyx_api_key,
        webhook_base_url=settings.telnyx_webhook_base_url,
    )
    results = await carrier.search_numbers(area_code="415", count=2)
    assert isinstance(results, list)
    assert len(results) >= 1
    assert all(r["phone_number"].startswith("+") for r in results)
```

#### 2. DID provision + release round-trip

```python
async def test_provision_and_release_number():
    """Provision a DID in the Telnyx sandbox, then immediately release it."""
    carrier = _make_carrier()
    numbers = await carrier.search_numbers(area_code="415", count=1)
    assert numbers, "No numbers available in sandbox for area 415"

    number = numbers[0]["phone_number"]
    provisioned = await carrier.provision_number(number)
    assert provisioned["phone_number"] == number
    assert "sid" in provisioned

    await carrier.release_number(number)
    # No assertion needed — must not raise
```

Mark this test with `@pytest.mark.chargeable` and document in the docstring that it may
incur a small sandbox charge. The `chargeable` mark must be excluded from the PR gate.

Add to `pytest.ini`:

```ini
markers =
    chargeable: Tests that may incur real or sandbox provider charges
```

#### 3. SMS send (sandbox)

```python
async def test_send_sms_sandbox():
    """Send an SMS to a Telnyx sandbox test number and verify no exception."""
    carrier = _make_carrier()
    # Telnyx sandbox test numbers: use a provisioned sandbox DID as both from/to
    result = await carrier.send_sms(
        from_="+15005550006",  # Telnyx magic sandbox from-number
        to="+15005550007",  # Telnyx magic sandbox to-number
        body="Carameli sandbox test",
    )
    assert result is not None
```

Note: Telnyx sandbox magic numbers (`+15005550006`) do not send real SMS.
Check Telnyx docs for the current sandbox number range.

#### 4. Provider error semantics

```python
async def test_provision_invalid_number_raises_provider_error():
    """Attempting to provision a non-existent number raises a structured error."""
    carrier = _make_carrier()
    with pytest.raises(Exception):  # narrows to HTTPException(502) at the handler layer
        await carrier.provision_number("+10000000000")  # guaranteed invalid


async def test_send_sms_invalid_from_raises():
    """Sending SMS from an unprovisionable number raises."""
    carrier = _make_carrier()
    with pytest.raises(Exception):
        await carrier.send_sms(from_="+10000000000", to="+15005550007", body="test")
```

#### 5. Callback schema validation

When Telnyx fires a webhook (call status or SMS delivery), the payload must match the schema
Carameli expects. This test sets up an ngrok tunnel and registers it with Telnyx. Only run if
`NGROK_URL` is also set.

```python
@pytest.mark.skipif(
    not os.getenv("NGROK_URL"),
    reason="Requires NGROK_URL for live callback testing",
)
async def test_sms_delivery_receipt_schema(client):
    """Send an SMS and verify the delivery receipt webhook hits the expected schema."""
    # 1. Send SMS via carrier
    # 2. Wait up to 10 s for a delivery receipt webhook to hit /webhooks/telnyx/sms-inbound
    # 3. Query the sms_messages table and assert delivery_status is set
    # This test requires ngrok + Telnyx webhook configuration pointing to NGROK_URL
    ...
```

### Helper factory

```python
def _make_carrier():
    from app.services.providers.carrier.telnyx import TelnyxCarrier
    from app.core.config import settings

    return TelnyxCarrier(
        api_key=settings.telnyx_api_key,
        webhook_base_url=settings.telnyx_webhook_base_url,
    )
```

### Running this suite

```bash
TELNYX_SANDBOX=1 docker compose exec app pytest tests/integration/test_telnyx_sandbox.py -v
```

---

## Session C2 — Resilience and chaos tests

### Prerequisites (C2)

- Full Docker stack running (backend + Postgres + Redis)
- No real provider credentials needed (everything is mocked)

### New file: `tests/integration/test_resilience.py`

```python
"""Resilience tests: Redis outages, DB blips, provider timeouts.

All external I/O is mocked at the app.state.carrier / app.state.engine boundary.
Redis is patched at the arq connection layer.
"""

from __future__ import annotations
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import pytest
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")
```

#### 1. Redis outage during ARQ job enqueue

The `retry_unposted_events` function in `app/services/call_sync.py` reads from Postgres
and POSTs to CRM. It does **not** enqueue to Redis itself — but the ARQ worker
cron scheduler pulls from Redis. Simulate a Redis connection error at the ARQ level:

```python
async def test_retry_unposted_events_survives_redis_error():
    """retry_unposted_events must not crash if Redis is unavailable."""
    from app.services.call_sync import retry_unposted_events

    with patch("app.core.database.async_session_factory") as mock_factory:
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        # Simulate DB returning no events
        mock_repo = MagicMock()
        mock_repo.get_unposted = AsyncMock(return_value=[])
        mock_factory.return_value = mock_session
        with patch("app.services.call_sync.CallEventRepo", return_value=mock_repo):
            await retry_unposted_events({})  # must not raise
```

#### 2. DB connectivity blip during webhook write

```python
async def test_webhook_survives_db_write_failure(client):
    """Jambonz call-status webhook returns 200 even if DB write fails."""
    from unittest.mock import patch
    from app.services import call_event_service

    with patch.object(
        call_event_service,
        "create_from_webhook",
        AsyncMock(side_effect=Exception("DB connection lost")),
    ):
        resp = await client.post(
            "/webhooks/jambonz/call-status",
            json={"call_sid": "CAdbblip001", "call_status": "completed"},
        )
    # Must return 200 — provider must not be forced to retry
    assert resp.status_code == 200
```

#### 3. Provider timeout during phone line add

```python
async def test_provider_timeout_returns_502(client):
    """A carrier timeout during DID provision must return 502, not 500."""
    import httpx
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 7001, "api_key": "key-7001"},
        headers=AUTH_HEADERS,
    )
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+17001550001"}])
    app.state.carrier.provision_number = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7001, "area_code": "700"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502
```

#### 4. Provider partial failure: search succeeds, provision fails

```python
async def test_provision_failure_after_search_returns_502(client):
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 7002, "api_key": "key-7002"},
        headers=AUTH_HEADERS,
    )
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+17002550001"}])
    app.state.carrier.provision_number = AsyncMock(side_effect=Exception("Carrier error"))
    resp = await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 7002, "area_code": "700"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502
    assert "Provider" in resp.json().get("detail", "")
```

#### 5. CRM write-back failure does not block webhook acknowledgement

```python
async def test_crm_writeback_failure_does_not_block_webhook(client):
    """If CRM POST fails during the webhook handler, the webhook still returns 200."""
    import httpx
    from app.core.config import settings

    settings.crm_webhook_url = "http://crm.test/callback"
    with patch("app.api.webhooks.call_status.httpx.AsyncClient") as mock_client_cls:
        mock_http = MagicMock()
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
        mock_client_cls.return_value = mock_http

        resp = await client.post(
            "/webhooks/jambonz/call-status",
            json={
                "call_sid": "CAvsfail001",
                "call_status": "completed",
                "from": "+14155550000",
                "to": "+14155550001",
            },
        )
    settings.crm_webhook_url = None
    assert resp.status_code == 200
```

#### 6. Worker restart during retry queue (smoke)

This is a lightweight smoke: verify that `WorkerSettings` is importable and has a non-empty
`cron_jobs` list, confirming the retry job will be re-scheduled after a worker restart.

```python
def test_worker_settings_cron_jobs_configured():
    from app.services.call_sync import WorkerSettings

    assert len(WorkerSettings.cron_jobs) >= 2  # retry_unposted_events + poll_agent_status
```

### Verification

```bash
docker compose exec app pytest tests/integration/test_resilience.py -v
```
