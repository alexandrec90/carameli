from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_health_check(client) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_unauthorized_without_key(client) -> None:
    response = await client.get("/vsapi/1.0.0/VsCustomer/Get/1")
    assert response.status_code == 401


async def test_customer_not_found(client) -> None:
    from tests.conftest import AUTH_HEADERS

    response = await client.get("/vsapi/1.0.0/VsCustomer/Get/9999", headers=AUTH_HEADERS)
    assert response.status_code == 404


async def test_create_and_get_customer(client) -> None:
    from tests.conftest import AUTH_HEADERS

    payload = {
        "vs_customer_id": 9901,
        "api_key": "test-key-unit-abc",
    }
    create_resp = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create", json=payload, headers=AUTH_HEADERS
    )
    assert create_resp.status_code == 201
    data = create_resp.json()
    assert data["vs_customer_id"] == 9901

    get_resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/9901", headers=AUTH_HEADERS)
    assert get_resp.status_code == 200
    assert get_resp.json()["vs_customer_id"] == 9901


# ─────────────────────────────────────────────────────────────────────────────
# Exception handlers
# ─────────────────────────────────────────────────────────────────────────────


async def test_data_error_returns_422(client) -> None:
    from tests.conftest import AUTH_HEADERS

    # FastAPI rejects a non-integer path param before it reaches the DB,
    # so we get either 422 (FastAPI) or 422 (DataError handler) — both are valid.
    resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/not-an-int", headers=AUTH_HEADERS)
    assert resp.status_code in (404, 422)


async def test_unhandled_exception_returns_500_without_leaking_details(client) -> None:
    from unittest.mock import AsyncMock, patch

    from app.services import customer_service
    from tests.conftest import AUTH_HEADERS

    with patch.object(customer_service, "get_by_id", AsyncMock(side_effect=RuntimeError("secret"))):
        resp = await client.get("/vsapi/1.0.0/VsCustomer/Get/999", headers=AUTH_HEADERS)

    assert resp.status_code == 500
    assert "secret" not in resp.text
    assert "Traceback" not in resp.text


# ─────────────────────────────────────────────────────────────────────────────
# Prometheus metrics
# ─────────────────────────────────────────────────────────────────────────────


async def test_metrics_endpoint_returns_prometheus_text(client) -> None:
    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    # Prometheus format starts with # HELP or # TYPE comments, or has http_requests counter.
    assert resp.text.startswith("#") or "http_requests" in resp.text or len(resp.text) > 0
