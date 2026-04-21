from __future__ import annotations

import pytest

from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")

_URL = "/vg/1.0.0/frontend-logs"


async def test_ingest_logs_returns_204(client) -> None:
    resp = await client.post(
        _URL,
        json={"entries": [{"level": "info", "message": "hello"}]},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 204


async def test_ingest_logs_requires_auth(client) -> None:
    resp = await client.post(
        _URL,
        json={"entries": [{"level": "info", "message": "hello"}]},
    )
    assert resp.status_code == 401


async def test_ingest_empty_batch(client) -> None:
    resp = await client.post(_URL, json={"entries": []}, headers=AUTH_HEADERS)
    assert resp.status_code == 204


@pytest.mark.parametrize("level", ["debug", "info", "warn", "warning", "error", "UNKNOWN"])
async def test_ingest_all_levels(client, level: str) -> None:
    resp = await client.post(
        _URL,
        json={"entries": [{"level": level, "message": "msg"}]},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 204


async def test_ingest_with_context(client) -> None:
    resp = await client.post(
        _URL,
        json={"entries": [{"level": "error", "message": "bad", "context": {"status": 502}}]},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 204
