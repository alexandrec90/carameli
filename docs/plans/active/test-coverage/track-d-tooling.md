# Track D — Observability, Parity, Performance, and Mutation Testing

Four sequential sessions. Each can technically start once Tracks A and B are complete,
but D1 and D2 are independent of each other and can be parallelized if two agents are available.

---

## Session D1 — Observability tests

**Goal:** Assert that critical flows emit the expected structured log entries and that the
Prometheus metrics endpoint works.

### New file: `tests/unit/test_observability.py`

Use pytest's built-in `caplog` fixture to assert log output.
Import `logging` constants — do not hard-code level numbers.

```python
from __future__ import annotations
import logging
import pytest
from unittest.mock import AsyncMock
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")
```

#### 1. Phone line add logs INFO on success

```python
async def test_phone_line_add_logs_entry_and_success(client, caplog):
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
        await client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 6001, "area_code": "600"},
            headers=AUTH_HEADERS,
        )
    assert any("6001" in r.message for r in caplog.records), "Expected vs_customer_id in log output"
    assert any("PNobs001" in r.message or "+16001550001" in r.message for r in caplog.records), (
        "Expected phone number/SID in success log"
    )
```

#### 2. Webhook handler logs call_sid and status

```python
async def test_webhook_logs_call_sid(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.api.webhooks.call_status"):
        await client.post(
            "/webhooks/jambonz/call-status",
            json={
                "call_sid": "CAlogtest001",
                "call_status": "completed",
                "from": "+14155550000",
                "to": "+14155550001",
            },
        )
    messages = " ".join(r.message for r in caplog.records)
    assert "CAlogtest001" in messages
    assert "completed" in messages
```

#### 3. Provider error logs at ERROR level

```python
async def test_provider_error_logs_at_error_level(client, caplog):
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 6002, "api_key": "key-6002"},
        headers=AUTH_HEADERS,
    )
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+16002550001"}])
    app.state.carrier.provision_number = AsyncMock(side_effect=Exception("Carrier error"))
    with caplog.at_level(logging.ERROR, logger="app.api.vsapi.phone_lines"):
        await client.post(
            "/vsapi/1.0.0/PhoneLine/Add",
            json={"vs_customer_id": 6002, "area_code": "600"},
            headers=AUTH_HEADERS,
        )
    error_records = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert error_records, "Expected at least one ERROR log on provider failure"
    assert any("6002" in r.message for r in error_records)
```

#### 4. No secrets in log output

```python
async def test_no_api_key_in_logs(client, caplog):
    """Ensure the API key never appears in log output."""
    from app.core.config import settings

    with caplog.at_level(logging.DEBUG):
        await client.get("/vsapi/1.0.0/VsCustomer/Get/1", headers=AUTH_HEADERS)
    for record in caplog.records:
        assert settings.api_key_secret not in record.message, (
            f"API key leaked in log: {record.message}"
        )
```

#### 5. Key metrics emitted for request paths

```python
async def test_metrics_endpoint_tracks_request_count(client):
    """Verify that Prometheus metrics track HTTP request counts after some requests."""
    # Fire a few requests
    await client.get("/health")
    await client.get("/health")

    resp = await client.get("/metrics")
    assert resp.status_code == 200
    # http_requests_total is the metric name emitted by prometheus-fastapi-instrumentator
    assert "http_requests_total" in resp.text or "http_request_duration" in resp.text
```

#### 6. Frontend log entries appear in the application log

```python
async def test_frontend_logs_written_to_logger(client, caplog):
    with caplog.at_level(logging.ERROR, logger="frontend"):
        await client.post(
            "/vg/1.0.0/frontend-logs",
            json={
                "entries": [
                    {"level": "error", "message": "frontend-boom", "context": {"status": 502}}
                ]
            },
            headers=AUTH_HEADERS,
        )
    fe_records = [r for r in caplog.records if "frontend-boom" in r.message]
    assert fe_records, "Frontend error should appear in the 'frontend' logger"
    assert fe_records[0].levelno == logging.ERROR
```

---

## Session D2 — VanillaLand contract parity tests

**Goal:** For each Carameli endpoint that replaces a VanillaLand ASMX web service, assert that
the request/response shape and error semantics match the legacy contract.

### Context

VanillaLand is in `../VanillaLand/`. See `CLAUDE.md` for the technology mapping table.
The primary contracts to cover:

| VanillaLand | Carameli endpoint |
|---|---|
| `SMSWS.asmx` → `SendSMS` | `POST /vsapi/1.0.0/VsMessaging/Sms/Send` |
| `CMVCallInfo.asmx` → call status | `POST /webhooks/jambonz/call-status` |
| `CmvCallback.cs` → `ByExtension` | `POST /vsapi/1.0.0/VsCallback/ByExtension` |
| `CmvCustomer.cs` → `VsCustomer/Add` | `POST /vsapi/1.0.0/VsCustomer/Create` |
| `tblPhoneNumber` lifecycle | `/vsapi/1.0.0/PhoneLine/*` |

### New file: `tests/integration/test_vanillaland_parity.py`

For each row in the table above, read the VanillaLand source file listed in
the VanillaLand mapping in root `CLAUDE.md` and write a test that:

1. Sends the exact request shape VanillaLand would send (field names, casing, data types).
2. Asserts the Carameli response matches the shape VanillaLand expects back.
3. Where VanillaLand returns a specific error code/message for an invalid input, assert
   Carameli returns a semantically equivalent HTTP error.

```python
"""VanillaLand contract parity tests.

Each test is annotated with the VanillaLand source file it mirrors.
Payload shapes are taken directly from the ASMX service contracts.
"""

from __future__ import annotations
import pytest
from unittest.mock import AsyncMock
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

# ── SMS contract (mirrors SMSWS.asmx SendSMS) ─────────────────────────────


async def test_sms_send_vanillaland_payload_shape(client):
    """VanillaLand sends: vs_customer_id, from_number, to_number, message_body."""
    from app.main import app

    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 5501, "api_key": "key-5501"},
        headers=AUTH_HEADERS,
    )
    # Provision a phone line for the customer so from_number resolves
    app.state.carrier.search_numbers = AsyncMock(return_value=[{"phone_number": "+15501550001"}])
    app.state.carrier.provision_number = AsyncMock(
        return_value={"sid": "PNvl001", "phone_number": "+15501550001"}
    )
    await client.post(
        "/vsapi/1.0.0/PhoneLine/Add",
        json={"vs_customer_id": 5501, "area_code": "550"},
        headers=AUTH_HEADERS,
    )
    app.state.carrier.send_sms = AsyncMock(return_value={"sid": "SMvl001", "status": "queued"})
    # VanillaLand payload shape
    resp = await client.post(
        "/vsapi/1.0.0/VsMessaging/Sms/Send",
        json={
            "vs_customer_id": 5501,
            "from_number": "+15501550001",
            "to_number": "+14155550099",
            "message_body": "Hello from parity test",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert "sid" in data or "message_sid" in data, (
        "Response must include a message SID (VanillaLand reads this field)"
    )


# ── Customer provisioning (mirrors CmvCustomer.cs VsCustomer/Add) ─────────


async def test_customer_create_vanillaland_required_fields(client):
    """VanillaLand sends: vs_customer_id (int), api_key (str)."""
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 5502, "api_key": "key-5502"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["vs_customer_id"] == 5502
    # VanillaLand checks that the returned id is a UUID-shaped string
    import uuid

    uuid.UUID(data["id"])  # raises ValueError if not a UUID


async def test_customer_create_duplicate_vs_id_returns_409(client):
    """VanillaLand expects a 409 (or equivalent) on duplicate vs_customer_id."""
    await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 5503, "api_key": "key-5503a"},
        headers=AUTH_HEADERS,
    )
    resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": 5503, "api_key": "key-5503b"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 409


# ── Call status webhook (mirrors CMVCallInfo.asmx) ────────────────────────


async def test_call_status_webhook_vanillaland_payload(client):
    """VanillaLand's Jambonz equivalent sends: call_sid, call_status, duration, from, to."""
    resp = await client.post(
        "/webhooks/jambonz/call-status",
        json={
            "call_sid": "CAvl001",
            "call_status": "completed",
            "duration": "120",
            "from": "+14155550001",
            "to": "+14155550002",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"


# Add more parity tests for: PhoneLine/Add, PhoneLine/Deactivate, VsExtension/Add
# Read the VanillaLand source files in ../VanillaLand/ to get exact field names.
```

### Snapshot approach (optional enhancement)

After the test suite is green, consider adding response snapshot tests using `syrupy`:

```bash
pip install syrupy
pytest tests/integration/test_vanillaland_parity.py --snapshot-update
```

On subsequent runs, any response shape change will fail the snapshot test.

---

## Session D3 — Performance test expansion

**Goal:** Expand `tests/load/locustfile.py` with realistic load profiles.
Locust is a separate tool — it is NOT run with pytest.

### Read the existing `tests/load/locustfile.py` in full before starting

### Add the following `HttpUser` tasks

```python
from locust import HttpUser, task, between, events
import random


class CarameliUser(HttpUser):
    wait_time = between(0.5, 2.0)
    headers = {"Authorization": "Bearer change_me"}  # set via LOCUST_API_KEY env

    @task(5)
    def health_check(self):
        self.client.get("/health")

    @task(3)
    def get_phone_line_count(self):
        cid = random.choice([1001, 1002, 1003])  # pre-seeded test customers
        self.client.get(f"/vsapi/1.0.0/PhoneLine/GetCount/{cid}")

    @task(2)
    def list_extensions(self):
        cid = random.choice([1001, 1002, 1003])
        self.client.get(f"/vsapi/1.0.0/VsExtension/GetAvailable/{cid}/100/200")

    @task(1)
    def send_sms(self):
        self.client.post(
            "/vsapi/1.0.0/VsMessaging/Sms/Send",
            json={
                "vs_customer_id": 1001,
                "from_number": "+11001550001",
                "to_number": "+14155550099",
                "message_body": "Load test SMS",
            },
            name="/vsapi/.../Sms/Send",
        )

    @task(1)
    def webhook_call_status(self):
        import uuid

        self.client.post(
            "/webhooks/jambonz/call-status",
            json={
                "call_sid": f"CAload{uuid.uuid4().hex[:8]}",
                "call_status": "completed",
                "from": "+14155550000",
                "to": "+14155550001",
                "duration": "30",
            },
            name="/webhooks/jambonz/call-status",
        )
```

### Load profiles to define as separate `HttpUser` subclasses

| Profile | Class name | `wait_time` | Headcount |
|---|---|---|---|
| Sustained load | `SustainedUser` | `between(0.5, 2.0)` | 50 users |
| Stress | `StressUser` | `between(0.1, 0.5)` | 200 users |
| Spike | `SpikeUser` | `constant(0)` | 500 users for 30 s |
| Soak | `SustainedUser` | `between(1.0, 3.0)` | 20 users for 60 min |

Add these as separate classes or use Locust's `LoadTestShape` for the spike/soak profiles.

### Locust shape class (spike)

```python
from locust import LoadTestShape


class SpikeShape(LoadTestShape):
    stages = [
        {"duration": 60, "users": 10, "spawn_rate": 10},  # warm-up
        {"duration": 90, "users": 500, "spawn_rate": 100},  # spike
        {"duration": 120, "users": 10, "spawn_rate": 10},  # recovery
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return stage["users"], stage["spawn_rate"]
        return None
```

### Running (D3)

```bash
# Sustained load: 50 users for 5 minutes
locust -f tests/load/locustfile.py --headless -u 50 -r 5 --run-time 5m \
  --host http://localhost:8000 --html reports/load-sustained.html

# Spike test
locust -f tests/load/locustfile.py --headless --shape-class SpikeShape \
  --host http://localhost:8000
```

### Baseline thresholds (capture and document)

After the first run, record p50/p95/p99 latency and error rate for each task in a file
`docs/evidence/performance-baselines.md`. Future runs should not exceed these by more than 20%.

---

## Session D4 — Mutation testing

**Goal:** Set up `mutmut` on the highest-risk business logic modules and track mutation score.

### Prerequisites

```bash
pip install mutmut
# Add to requirements-dev.txt
```

### Configuration — `setup.cfg` or `mutmut` section in `pyproject.toml`

```ini
[mutmut]
paths_to_mutate = app/services/call_sync.py,app/services/agent_status_sync.py,app/api/webhooks/call_status.py,app/api/webhooks/sms_inbound.py,app/core/session.py
tests_dir = tests/unit/
runner = pytest tests/unit/ -x -q
```

Start with these five files. They contain the highest-risk logic (retry, HMAC, Ed25519, session).

### Running (D4)

```bash
mutmut run
mutmut results       # summary
mutmut show <id>     # inspect a surviving mutant
```

### Interpreting results

A **surviving mutant** means the code changed without any test failing — a test gap.
For each surviving mutant:

1. Read the mutant (`mutmut show <id>`) to understand what it changed.
2. Write a test that would catch that change.
3. Re-run `mutmut run` to verify the mutant is now killed.

### Mutation score target

Aim for > 80% killed on the five configured modules before moving on.
Record the baseline score in `docs/evidence/mutation-score-baseline.md`.

### CI integration (add after Track E)

```yaml
# .github/workflows/mutation.yml (weekly)
- name: Run mutation tests
  run: mutmut run || true   # non-zero exit is expected when mutants survive
- name: Upload results
  run: mutmut results > mutation-report.txt
  continue-on-error: true
```
