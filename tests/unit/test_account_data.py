from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.main import app
from app.services.providers.base import ProvisionedSipClient
from tests.conftest import AUTH_HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_customer(client, vs_customer_id: int, api_key: str) -> None:
    response = await client.post(
        "/vsapi/1.0.0/VsCustomer/Create",
        json={"vs_customer_id": vs_customer_id, "api_key": api_key},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 201


async def test_account_data_delivers_provisioned_sip_secret_once(client) -> None:
    await _create_customer(client, 9410, "account-key-9410")
    app.state.engine.provision_sip_client = AsyncMock(
        return_value=ProvisionedSipClient("client-9410", "sip.example.test")
    )

    created = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={
            "vs_customer_id": 9410,
            "extension_number": "310",
            "password": "one-time-secret-9410",  # pragma: allowlist secret - test fixture value
            "first_name": "Ada",
            "last_name": "Lovelace",
        },
        headers=AUTH_HEADERS,
    )
    assert created.status_code == 201, created.text
    assert "sip_password" not in created.json()
    assert "sipPassword" not in created.json()
    app.state.engine.provision_sip_client.assert_awaited_once_with(
        created.json()["sip_username"], "one-time-secret-9410"
    )

    delivered = await client.post(
        "/vsapi/1.0.0/AccessCheck/AccountData",
        json=[9410],
        headers={"Authorization": "Bearer account-key-9410"},
    )
    assert delivered.status_code == 200
    extension = delivered.json()[0]["Extensions"][0]
    assert extension == {
        "fullName": "Ada Lovelace",
        "firstName": "Ada",
        "lastName": "Lovelace",
        "extension": "310",
        "sipUsername": created.json()["sip_username"],
        "sipPassword": "one-time-secret-9410",  # pragma: allowlist secret - test fixture value
        "sipDomain": "sip.example.test",
    }

    repeated = await client.post(
        "/vsapi/1.0.0/AccessCheck/AccountData",
        json=[9410],
        headers={"Authorization": "Bearer account-key-9410"},
    )
    assert repeated.status_code == 200
    assert repeated.json()[0]["Extensions"] == []


async def test_account_data_enforces_customer_scope(client) -> None:
    await _create_customer(client, 9411, "account-key-9411")
    await _create_customer(client, 9412, "account-key-9412")
    response = await client.post(
        "/vsapi/1.0.0/AccessCheck/AccountData",
        json=[9411],
        headers={"Authorization": "Bearer account-key-9412"},
    )
    assert response.status_code == 403


async def test_extension_provisioning_failure_does_not_create_row(client) -> None:
    await _create_customer(client, 9413, "account-key-9413")
    app.state.engine.provision_sip_client = AsyncMock(side_effect=RuntimeError("unavailable"))
    response = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={"vs_customer_id": 9413, "extension_number": "313"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 502
    available = await client.get(
        "/vsapi/1.0.0/VsExtension/GetAvailable/9413/313/313",
        headers=AUTH_HEADERS,
    )
    assert available.status_code == 200
    assert available.json()["available"] == ["313"]


async def test_extension_provisioning_requires_independent_encryption_secret(
    client, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _create_customer(client, 9414, "account-key-9414")
    monkeypatch.setattr(settings, "sip_credential_encryption_secret", "")
    app.state.engine.provision_sip_client = AsyncMock()

    response = await client.post(
        "/vsapi/1.0.0/VsExtension/Add",
        json={"vs_customer_id": 9414, "extension_number": "314"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 503
    app.state.engine.provision_sip_client.assert_not_awaited()
