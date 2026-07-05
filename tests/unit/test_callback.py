from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.services import callback_state
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


class _FakeRedis:
    """In-memory stand-in for the Redis client (external boundary mock)."""

    def __init__(self, store: dict[str, str]) -> None:
        self._store = store

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._store[key] = value

    async def getdel(self, key: str) -> str | None:
        return self._store.pop(key, None)

    async def aclose(self) -> None:
        return None


@pytest.fixture
def fake_redis_store(monkeypatch) -> dict[str, str]:
    """Patch callback_state's Redis client with a dict-backed fake; returns the dict."""
    store: dict[str, str] = {}
    monkeypatch.setattr(callback_state, "get_redis_client", lambda: _FakeRedis(store))
    return store


_CUST_BASE = "/vsapi/1.0.0/VsCustomer"
_EXT_BASE = "/vsapi/1.0.0/VsExtension"
_CB_BASE = "/vsapi/1.0.0/Callback"
_CB_ANSWERED = "/webhooks/jambonz/callback-answered"


async def _create_customer(client, vs_id: int) -> None:
    resp = await client.post(
        f"{_CUST_BASE}/Create",
        json={"vs_customer_id": vs_id, "api_key": f"key-{vs_id}"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201


async def _add_extension(client, vs_id: int, ext_number: str) -> dict:
    from app.main import app

    app.state.carrier.provision_number = AsyncMock(
        return_value={"provider_sid": f"PNtest{vs_id}", "phone_number": f"+1{vs_id}0000"}
    )
    resp = await client.post(
        f"{_EXT_BASE}/Add",
        json={"vs_customer_id": vs_id, "extension_number": ext_number},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 201, resp.json()
    return resp.json()


# ---------------------------------------------------------------------------
# POST /Callback/ByExtension — happy path
# ---------------------------------------------------------------------------


async def test_callback_by_extension_success(client) -> None:
    """Valid request initiates the callback and returns call_sid + status."""
    from app.main import app

    await _create_customer(client, 8501)
    await _add_extension(client, 8501, "101")

    app.state.engine.initiate_callback = AsyncMock(
        return_value={"call_id": "CS-cb-001", "status": "queued"}
    )

    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={
            "vs_customer_id": 8501,
            "extension": "101",
            "destination_number": "+12125550100",
        },
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["call_sid"] == "CS-cb-001"
    assert body["status"] == "queued"
    app.state.engine.initiate_callback.assert_awaited_once()
    call_kwargs = app.state.engine.initiate_callback.call_args
    assert call_kwargs.kwargs["contact_number"] == "+12125550100"
    assert "callback-answered" in call_kwargs.kwargs["webhook_url"]


# ---------------------------------------------------------------------------
# POST /Callback/ByExtension — error paths
# ---------------------------------------------------------------------------


async def test_callback_unknown_customer_returns_404(client) -> None:
    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={"vs_customer_id": 99990, "extension": "101", "destination_number": "+12125550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Customer not found"


async def test_callback_unknown_extension_returns_404(client) -> None:
    await _create_customer(client, 8502)
    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={"vs_customer_id": 8502, "extension": "999", "destination_number": "+12125550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Extension not found"


async def test_callback_engine_error_returns_502(client) -> None:
    from app.main import app

    await _create_customer(client, 8503)
    await _add_extension(client, 8503, "201")

    app.state.engine.initiate_callback = AsyncMock(side_effect=RuntimeError("Jambonz unavailable"))

    resp = await client.post(
        f"{_CB_BASE}/ByExtension",
        json={"vs_customer_id": 8503, "extension": "201", "destination_number": "+12125550100"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Call engine error"


# ---------------------------------------------------------------------------
# POST /webhooks/jambonz/callback-answered
# ---------------------------------------------------------------------------


async def test_callback_answered_returns_dial_verb(client, fake_redis_store) -> None:
    """When the agent answers, the webhook returns a dial verb for the contact."""
    call_sid = "CS-answered-001"
    contact = "+13335550100"

    await callback_state.set_pending_callback(call_sid, contact)

    resp = await client.post(
        _CB_ANSWERED,
        json={"call_sid": call_sid, "from": "+17771110000"},
    )
    assert resp.status_code == 200
    verbs = resp.json()
    assert len(verbs) == 1
    assert verbs[0]["verb"] == "dial"
    assert verbs[0]["target"][0]["number"] == contact

    # State entry should be consumed
    assert fake_redis_store == {}


async def test_callback_answered_unknown_call_sid_returns_empty(client, fake_redis_store) -> None:
    """No pending state for the call_sid: return empty verb array."""
    resp = await client.post(
        _CB_ANSWERED,
        json={"call_sid": "CS-no-state", "from": "+17771110000"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_callback_answered_redis_down_returns_empty(client, monkeypatch) -> None:
    """A Redis outage must not break webhook acknowledgement — empty verbs, no 5xx."""

    def _broken_client():
        raise ConnectionError("redis down")

    monkeypatch.setattr(callback_state, "get_redis_client", _broken_client)
    resp = await client.post(
        _CB_ANSWERED,
        json={"call_sid": "CS-redis-down", "from": "+17771110000"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_pending_callback_set_uses_ttl(monkeypatch) -> None:
    """set_pending_callback stores the contact under a TTL and pop consumes it."""
    captured: dict[str, int | None] = {}
    store: dict[str, str] = {}

    class _TtlRedis(_FakeRedis):
        async def set(self, key: str, value: str, ex: int | None = None) -> None:
            captured["ex"] = ex
            await super().set(key, value, ex=ex)

    monkeypatch.setattr(callback_state, "get_redis_client", lambda: _TtlRedis(store))

    await callback_state.set_pending_callback("CS-ttl-001", "+15550001111")

    assert captured["ex"] == callback_state.PENDING_CALLBACK_TTL_SECONDS
    assert await callback_state.pop_pending_callback("CS-ttl-001") == "+15550001111"
    assert store == {}


async def test_callback_answered_invalid_json_returns_400(client) -> None:
    resp = await client.post(
        _CB_ANSWERED,
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
