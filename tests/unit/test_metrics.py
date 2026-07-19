from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest
from prometheus_client import REGISTRY

from app.core.metrics import refresh_operational_metrics
from app.core.redis import get_redis
from app.main import app
from app.models.call_event import CallEvent
from app.models.sms_message import SmsMessage

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _metric_value(name: str) -> float:
    value = REGISTRY.get_sample_value(name)
    assert value is not None
    return value


async def test_refresh_operational_metrics_reports_seeded_counts(db_session) -> None:
    db_session.add_all(
        [
            CallEvent(call_sid="CAmetrics-unposted-1", posted=False),
            CallEvent(call_sid="CAmetrics-unposted-2", posted=False),
            CallEvent(call_sid="CAmetrics-posted", posted=True),
            SmsMessage(
                message_sid="MSmetrics-unposted",
                direction="inbound",
                from_number="+14155550101",
                to_number="+14155550102",
                body="unposted",
                posted=False,
            ),
            SmsMessage(
                message_sid="MSmetrics-posted",
                direction="inbound",
                from_number="+14155550103",
                to_number="+14155550104",
                body="posted",
                posted=True,
            ),
        ]
    )
    await db_session.commit()
    redis = AsyncMock()
    redis.llen.return_value = 17

    await refresh_operational_metrics(db_session, redis)

    assert _metric_value("carameli_unposted_call_events") == 2
    assert _metric_value("carameli_unposted_sms_messages") == 1
    assert _metric_value("carameli_arq_queue_depth") == 17
    redis.llen.assert_awaited_once_with("arq:queue")


async def test_refresh_operational_metrics_tolerates_redis_failure(db_session) -> None:
    redis = AsyncMock()
    redis.llen.side_effect = ConnectionError("redis unavailable")

    await refresh_operational_metrics(db_session, redis)

    assert _metric_value("carameli_unposted_call_events") >= 0
    assert _metric_value("carameli_unposted_sms_messages") >= 0


async def test_metrics_endpoint_exposes_carameli_series(client) -> None:
    redis = AsyncMock()
    redis.llen.return_value = 3

    async def override_redis() -> AsyncIterator[AsyncMock]:
        yield redis

    app.dependency_overrides[get_redis] = override_redis
    response = await client.get("/metrics")

    assert response.status_code == 200
    assert "carameli_unposted_call_events" in response.text
    assert "carameli_unposted_sms_messages" in response.text
    assert "carameli_arq_queue_depth" in response.text
    assert "carameli_webhook_failures_total" in response.text
